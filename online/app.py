"""Authenticated, project-scoped web service; no user files are served from disk."""
import hashlib
import html
import json
import logging
import os
import secrets
import tempfile
import time
import uuid
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit

import click
from flask import Flask, abort, g, jsonify, redirect, render_template, request
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

import checklist_tool as checklist
from .db import Database, project_state, snapshot

ROOT = Path(__file__).resolve().parent
SESSION_SECONDS = 7 * 24 * 3600


def hashed(value):
    return hashlib.sha256(value.encode()).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False)


def project_payload(project):
    permissions = json.loads(project['permissions'])
    return checklist.document_payload(
        project['document'], project['name'] + '.md', project['generation'],
        (permissions.get('selected', []), permissions.get('descs', {}), permissions.get('descsEn', {})),
        json.loads(project['review']), str(project['version']),
    )


def create_app(overrides=None):
    app = Flask(__name__, static_folder='static', template_folder='templates')
    production = os.getenv('APP_ENV', 'production') == 'production'
    app.config.update(
        DATABASE_URL=os.getenv('DATABASE_URL', ''),
        ADMIN_EMAIL=os.getenv('ADMIN_EMAIL', ''), ADMIN_PASSWORD=os.getenv('ADMIN_PASSWORD', ''),
        PUBLIC_BASE_URL=(os.getenv('PUBLIC_BASE_URL') or os.getenv('RENDER_EXTERNAL_URL', '')).rstrip('/'),
        COOKIE_SECURE=production, MAX_CONTENT_LENGTH=2_000_000,
        TESTING=False,
    )
    if overrides:
        app.config.update(overrides)
    if not app.config['DATABASE_URL']:
        if production and not app.config['TESTING']:
            raise RuntimeError('DATABASE_URL is required in production')
        app.config['DATABASE_URL'] = 'sqlite:///' + str(ROOT / 'local.sqlite3')
    if production and not app.config['TESTING'] and not app.config['DATABASE_URL'].startswith(('postgres://', 'postgresql://')):
        raise RuntimeError('Production requires persistent PostgreSQL; SQLite is preview-only')
    db = Database(app.config['DATABASE_URL'])
    db.initialize()
    app.extensions['release_db'] = db
    email = app.config['ADMIN_EMAIL'].strip().lower()
    password = app.config['ADMIN_PASSWORD']
    if email and password:
        if len(password) < 12:
            raise RuntimeError('ADMIN_PASSWORD must have at least 12 characters')
        with db.connect(write=True) as conn:
            if not conn.one('SELECT id FROM users WHERE email=?', (email,)):
                conn.execute('INSERT INTO users VALUES (?,?,?,?,?) ON CONFLICT(email) DO NOTHING',
                             (uuid.uuid4().hex, email, '项目管理员', generate_password_hash(password), int(time.time())))

    with db.connect() as conn:
        if not conn.one('SELECT id FROM users LIMIT 1') and not app.config['TESTING']:
            raise RuntimeError('First launch requires ADMIN_EMAIL and ADMIN_PASSWORD')

    @app.before_request
    def authenticate_and_protect():
        g.nonce = secrets.token_urlsafe(18)
        g.user = None
        g.session = None
        token = request.cookies.get('release_session', '')
        if token:
            with db.connect() as conn:
                session = conn.one('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?', (hashed(token), int(time.time())))
                if session:
                    g.user = conn.one('SELECT id,email,name FROM users WHERE id=?', (session['user_id'],))
                    g.session = session
        if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            origin = request.headers.get('Origin')
            expected = app.config['PUBLIC_BASE_URL'] or request.host_url.rstrip('/')
            if origin and origin != expected:
                abort(403, '不允许跨站请求')
            if not request.is_json:
                abort(415, '请使用 JSON 请求')
            if g.user and request.path not in ('/api/auth/login', '/api/invitations/accept'):
                csrf = request.headers.get('X-CSRF-Token', '')
                if not secrets.compare_digest(csrf, g.session['csrf']):
                    abort(403, '会话校验失败，请刷新页面')

    @app.after_request
    def security_headers(response):
        response.headers['Cache-Control'] = 'no-store' if not request.path.startswith('/static/') else 'public,max-age=3600'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self' 'nonce-" + g.nonce + "'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        )
        if app.config['COOKIE_SECURE']:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    @app.errorhandler(Exception)
    def handle_error(error):
        if isinstance(error, HTTPException):
            code, message = error.code, error.description
        else:
            app.logger.exception('Online request failed')
            code, message = 500, '服务暂时不可用，请稍后重试；未确认成功的改动请先导出'
        if request.path.startswith('/api/'):
            return jsonify(error=message), code
        return render_template('error.html', message=message, status=code), code

    def body():
        data = request.get_json()
        if not isinstance(data, dict):
            abort(400, '请求必须是对象')
        return data

    def require_user():
        if not g.user:
            abort(401, '请先登录')
        return g.user

    def access(conn, project_id, minimum='viewer', lock=False):
        require_user()
        sql = 'SELECT * FROM projects WHERE id=?'
        if lock and db.postgres:
            sql += ' FOR UPDATE'
        project = conn.one(sql, (project_id,))
        member = conn.one('SELECT role FROM members WHERE project_id=? AND user_id=?', (project_id, g.user['id']))
        if not project or not member:
            abort(404, '项目不存在或无权访问')
        levels = {'viewer': 0, 'editor': 1, 'owner': 2}
        if levels[member['role']] < levels[minimum]:
            abort(403, '当前角色没有操作权限')
        project['role'] = member['role']
        return project

    def compare_version(project, data):
        if str(data.get('revision', '')) != str(project['version']):
            abort(409, '项目已被其他页面或成员更新，请先导出草稿，再刷新核对')

    def start_session(user_id):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with db.connect(write=True) as conn:
            conn.execute('DELETE FROM sessions WHERE expires_at<?', (int(time.time()),))
            conn.execute('INSERT INTO sessions VALUES (?,?,?,?)', (hashed(token), user_id, csrf, int(time.time()) + SESSION_SECONDS))
        response = jsonify(ok=True, csrf=csrf)
        response.set_cookie('release_session', token, max_age=SESSION_SECONDS, secure=app.config['COOKIE_SECURE'], httponly=True, samesite='Lax')
        return response

    @app.get('/healthz')
    def health():
        with db.connect() as conn:
            conn.one('SELECT 1 AS ok')
        return jsonify(ok=True)

    @app.get('/')
    def home():
        return render_template('dashboard.html') if g.user else redirect('/login')

    @app.get('/login')
    def login_page():
        return redirect('/') if g.user else render_template('login.html')

    @app.get('/join')
    def join_page():
        return render_template('join.html')

    @app.get('/api/me')
    def me():
        require_user()
        return jsonify(user=g.user, csrf=g.session['csrf'])

    @app.post('/api/auth/login')
    def login():
        data = body()
        email = str(data.get('email', '')).strip().lower()[:254]
        password = str(data.get('password', ''))[:1024]
        now = int(time.time())
        buckets = ['email:' + hashed(email), 'ip:' + hashed(request.remote_addr or '')]
        with db.connect(write=True) as conn:
            conn.execute('DELETE FROM login_attempts WHERE created_at<?', (now - 900,))
            for bucket in buckets:
                count = conn.one('SELECT COUNT(*) AS n FROM login_attempts WHERE bucket=?', (bucket,))['n']
                if count >= (10 if bucket.startswith('email:') else 80):
                    abort(429, '尝试过于频繁，请 15 分钟后重试')
            for bucket in buckets:
                conn.execute('INSERT INTO login_attempts VALUES (?,?,?)', (uuid.uuid4().hex, bucket, now))
            user = conn.one('SELECT * FROM users WHERE email=?', (email,))
        if not user or not check_password_hash(user['password_hash'], password):
            abort(401, '邮箱或密码错误')
        with db.connect(write=True) as conn:
            conn.execute('DELETE FROM login_attempts WHERE bucket=?', (buckets[0],))
        return start_session(user['id'])

    @app.post('/api/auth/logout')
    def logout():
        require_user()
        with db.connect(write=True) as conn:
            conn.execute('DELETE FROM sessions WHERE token_hash=?', (g.session['token_hash'],))
        response = jsonify(ok=True)
        response.delete_cookie('release_session')
        return response

    @app.post('/api/auth/password')
    def change_password():
        require_user()
        data = body()
        password = str(data.get('password', ''))
        if not 12 <= len(password) <= 256:
            abort(400, '新密码需要 12–256 个字符')
        with db.connect(write=True) as conn:
            user = conn.one('SELECT * FROM users WHERE id=?', (g.user['id'],))
            if not check_password_hash(user['password_hash'], str(data.get('current', ''))):
                abort(403, '当前密码错误')
            conn.execute('UPDATE users SET password_hash=? WHERE id=?', (generate_password_hash(password), user['id']))
            conn.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        return start_session(g.user['id'])

    @app.get('/api/projects')
    def list_projects():
        require_user()
        with db.connect() as conn:
            rows = conn.all('SELECT p.*,m.role FROM projects p JOIN members m ON p.id=m.project_id WHERE m.user_id=? ORDER BY p.updated_at DESC', (g.user['id'],))
        result = []
        for row in rows:
            payload = project_payload(row)
            result.append({k: row[k] for k in ('id', 'name', 'role', 'updated_at', 'version')})
            result[-1].update(total=payload['total'], done=payload['done'], skipped=payload['skipped'], release=payload['review'].get('release', {}))
        return jsonify(projects=result)

    @app.post('/api/projects')
    def create_project():
        require_user()
        data = body()
        name = str(data.get('name', '')).strip()
        if not 1 <= len(name) <= 100:
            abort(400, '项目名称需要 1–100 个字符')
        document = data.get('document')
        if document is None:
            document = (ROOT / 'default_checklist.md').read_text(encoding='utf-8')
        if not isinstance(document, str) or not 1 <= len(document.encode()) <= 800_000:
            abort(400, 'Markdown 文件无效或超过 800 KB')
        if not checklist.parse_md(document)['items']:
            abort(400, '清单中至少需要一个 Markdown 检查项')
        permissions = data.get('permissions', {'selected': [], 'descs': {}, 'descsEn': {}})
        review = data.get('review', {'release': {}, 'items': {}, 'history': []})
        validate_permissions(permissions)
        validate_review(review)
        project_id, now = uuid.uuid4().hex, int(time.time())
        with db.connect(write=True) as conn:
            conn.execute('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?)', (project_id, name, document, encode(permissions), encode(review), 1, 1, now, now))
            conn.execute('INSERT INTO members VALUES (?,?,?)', (project_id, g.user['id'], 'owner'))
        return jsonify(id=project_id), 201

    @app.get('/projects/<project_id>')
    def board(project_id):
        if not g.user:
            return redirect('/login')
        with db.connect() as conn:
            project = access(conn, project_id)
        payload = project_payload(project)
        payload['built'] = time.strftime('%Y-%m-%d %H:%M')
        page = checklist.TEMPLATE.read_text(encoding='utf-8')
        cloud = {'projectId': project_id, 'userId': g.user['id'], 'csrf': g.session['csrf'], 'role': project['role']}
        script = 'window.RELEASE_CLOUD=' + encode(cloud).replace('</', '<\\/') + ';'
        js = (checklist.HERE / 'board.js').read_text(encoding='utf-8')
        js = js.replace('将恢复 Markdown 清单，当前文件会先备份。权限面板和发布记录保留当前值。未保存勾选将丢弃，是否继续？', '将恢复完整项目快照，包含清单、权限配置和发布记录；当前项目会先备份。未保存勾选将丢弃，是否继续？')
        js = js.replace('已连接 · 可写回文件', '云端已连接 · 修改可同步').replace('本地服务', '在线服务').replace('仅本机保存', '草稿仅保存在当前浏览器')
        if project['role'] == 'viewer':
            js += '\nconst lockViewer=()=>document.querySelectorAll("li.item input,li.item button,#btnSave,#releaseEdit,#releaseArchive,#backupRestore,#featSave,#permSave").forEach(el=>el.disabled=true); const viewerObserver=new MutationObserver(lockViewer); viewerObserver.observe(document.getElementById("list"),{childList:true,subtree:true}); lockViewer(); setTimeout(lockViewer,500);' 
        page = (page.replace('__PERMISSION_RULES__', (checklist.HERE / 'permission_rules.json').read_text(encoding='utf-8')).replace('__PERMISSION_VISIBILITY__', (checklist.HERE / 'permission_visibility.js').read_text(encoding='utf-8')).replace('__BOARD_CSS__', (checklist.HERE / 'board.css').read_text(encoding='utf-8'))
                .replace('__BOARD_JS__', script + '\n' + js)
                .replace('__TITLE__', html.escape(project['name']))
                .replace('__DATA__', encode(payload).replace('</', '<\\/'))
                .replace('__PROFILES__', encode(checklist.load_profiles()).replace('</', '<\\/')))
        banner = '<div style="padding:14px 24px;background:#17243a;color:white;display:flex;justify-content:space-between"><a style="color:white" href="/">← 返回项目工作台</a><span>' + html.escape(project['name']) + ' · ' + {'owner':'所有者','editor':'可编辑','viewer':'只读'}[project['role']] + '</span></div>'
        page = page.replace('权限面板和发布记录保留当前值，不随 Markdown 恢复', '检查状态、权限面板和发布记录一起恢复')
        return page.replace('<body>', '<body>' + banner).replace('<script>', '<script nonce="' + g.nonce + '">')

    @app.get('/projects/<project_id>/guide')
    def guide(project_id):
        if not g.user:
            return redirect('/login')
        with db.connect() as conn:
            project = access(conn, project_id)
        # Existing renderer is file-oriented; isolate its input to a temporary directory.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'guide.md'
            path.write_text(project['document'], encoding='utf-8')
            page = checklist.build_guide(path)
        prefix = '/api/projects/' + project_id
        page = page.replace('"/api/', '"' + prefix + '/').replace('online ? "/" :', 'online ? "/projects/' + project_id + '" :')
        page = page.replace('app-guide-ack', 'app-guide-ack:' + g.user['id'] + ':' + project_id)
        bootstrap = '<script nonce="' + g.nonce + '">let guideRevision=' + encode(str(project['version'])) + ';const nativeFetch=window.fetch;window.fetch=async(url,opt={})=>{if(opt.method==="POST"){opt={...opt,body:JSON.stringify({...JSON.parse(opt.body||"{}"),revision:guideRevision})};}const response=await nativeFetch(url,{...opt,headers:{...opt.headers,"X-CSRF-Token":' + encode(g.session['csrf']) + '}});const data=await response.clone().json().catch(()=>({}));if(data.revision)guideRevision=data.revision;return response;};</script>' 
        return page.replace('<script>', '<script nonce="' + g.nonce + '">').replace('</head>', bootstrap + '</head>')

    @app.get('/api/projects/<project_id>/export')
    def export_project(project_id):
        with db.connect() as conn:
            project = access(conn, project_id)
        response = jsonify(format='release-desk/v1', name=project['name'], document=project['document'], permissions=json.loads(project['permissions']), review=json.loads(project['review']))
        response.headers['Content-Disposition'] = 'attachment; filename="release-project.json"'
        return response

    @app.route('/api/projects/<project_id>/<operation>', methods=['GET', 'POST'])
    def project_operation(project_id, operation):
        reads = ('list', 'health', 'profiles', 'perm-config', 'perm-en-preview', 'perm-write-en', 'backups')
        if operation not in reads and request.method != 'POST':
            abort(405)
        with db.connect(write=request.method == 'POST') as conn:
            project = access(conn, project_id, 'viewer' if operation in reads else 'editor', lock=request.method == 'POST')
            data = body() if request.method == 'POST' else {}
            if operation in ('list', 'reload'):
                return jsonify(project_payload(project))
            if operation == 'health':
                return jsonify(ok=True)
            if operation == 'profiles':
                return jsonify(checklist.load_profiles())
            if operation in ('perm-config', 'perm-en-preview', 'perm-write-en'):
                permissions = {k: data.get(k, [] if k == 'selected' else {}) for k in ('selected', 'descs', 'descsEn')}
                validate_permissions(permissions)
                profiles = checklist.load_profiles()
                if operation == 'perm-config':
                    result = checklist.generate_config(profiles, permissions['selected'], permissions['descs'], permissions['descsEn'], lang=data.get('lang', 'zh'))
                    result['appendix'] = checklist.build_appendix(profiles, permissions['selected'], permissions['descs'], permissions['descsEn'])
                    return jsonify(result)
                doc = checklist.build_english_doc(profiles, permissions['selected'], permissions['descsEn'])
                return jsonify(doc=doc, saved=True, path='Privacy-and-Permissions-EN.md', lines=len(doc.splitlines()))
            if operation == 'backups':
                rows = conn.all('SELECT id,label,created_at FROM snapshots WHERE project_id=? ORDER BY created_at DESC,id DESC', (project_id,))
                return jsonify(backups=[row['id'] for row in rows], entries=rows)
            compare_version(project, data)
            snapshot(conn, project, g.user['id'], operation)
            extra = {}
            if operation == 'write':
                states = data.get('states')
                if not isinstance(states, dict) or any(v not in ('todo', 'done', 'skip') for v in states.values()):
                    abort(400, '检查状态无效')
                parsed = checklist.parse_md(project['document'])
                allowed = {x['id'] for x in parsed['items']}
                if not set(states).issubset(allowed):
                    abort(409, '清单结构已变化，请刷新')
                project['document'] = checklist.apply_states(project['document'], parsed, states)
                extra['saved'] = True
            elif operation == 'clear':
                parsed = checklist.parse_md(project['document'])
                gate = checklist.find_gate_item(parsed)
                states = {x['id']: 'todo' for x in parsed['items'] if x['state'] != 'todo' and (not gate or x['id'] != gate['id'])}
                project['document'] = checklist.apply_states(project['document'], parsed, states)
                project['generation'] += 1
                extra['cleared'] = len(states)
            elif operation in ('ack', 'unack'):
                parsed = checklist.parse_md(project['document'])
                gate = checklist.find_gate_item(parsed)
                if gate:
                    project['document'] = checklist.apply_states(project['document'], parsed, {gate['id']: 'done' if operation == 'ack' else 'skip'})
            elif operation == 'features':
                features = data.get('features')
                if isinstance(features, dict):
                    features = {'hasFeedbackSystem': False, **features}
                if not isinstance(features, dict) or any(type(features.get(k)) is not bool for k in ('hasAccountSystem', 'targetMinors', 'hasFeedbackSystem')):
                    abort(400, '项目特征无效')
                line = '<!-- FEATURES ' + ' '.join(k + '=' + str(int(features[k])) for k in ('hasAccountSystem', 'targetMinors', 'hasFeedbackSystem')) + ' -->'
                project['document'] = checklist.RE_FEATURES.sub(line, project['document']) if checklist.RE_FEATURES.search(project['document']) else line + '\n' + project['document']
            elif operation == 'review':
                validate_review(data.get('review'))
                project['review'] = encode(data['review'])
            elif operation == 'perm-write':
                permissions = {k: data.get(k, [] if k == 'selected' else {}) for k in ('selected', 'descs', 'descsEn')}
                validate_permissions(permissions)
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / 'checklist.md'
                    path.write_text(project['document'], encoding='utf-8')
                    extra['appendix'] = checklist.write_appendix(path, permissions['selected'], permissions['descs'], permissions['descsEn'])
                    project['document'] = path.read_text(encoding='utf-8')
                project['permissions'] = encode(permissions)
            elif operation == 'restore':
                backup = conn.one('SELECT state FROM snapshots WHERE id=? AND project_id=?', (data.get('name', ''), project_id))
                if not backup:
                    abort(404, '备份不存在')
                state = json.loads(backup['state'])
                project.update(state)
                project['generation'] += 1
            else:
                abort(404)
            project['version'] += 1
            project['updated_at'] = int(time.time())
            conn.execute('UPDATE projects SET name=?,document=?,permissions=?,review=?,version=?,generation=?,updated_at=? WHERE id=?',
                         (project['name'], project['document'], project['permissions'], project['review'], project['version'], project['generation'], project['updated_at'], project_id))
            result = project_payload(project)
            result.update(extra)
            return jsonify(result)

    @app.get('/api/projects/<project_id>/members')
    def members(project_id):
        with db.connect() as conn:
            access(conn, project_id, 'owner')
            rows = conn.all('SELECT u.id,u.email,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?', (project_id,))
        return jsonify(members=rows)

    @app.post('/api/projects/<project_id>/members')
    def update_member(project_id):
        data = body()
        with db.connect(write=True) as conn:
            access(conn, project_id, 'owner', lock=True)
            target = conn.one('SELECT role FROM members WHERE project_id=? AND user_id=?', (project_id, data.get('userId', '')))
            if not target or target['role'] == 'owner':
                abort(400, '无法修改所有者或不存在的成员')
            role = data.get('role')
            if role == 'remove':
                conn.execute('DELETE FROM members WHERE project_id=? AND user_id=?', (project_id, data['userId']))
            elif role in ('editor', 'viewer'):
                conn.execute('UPDATE members SET role=? WHERE project_id=? AND user_id=?', (role, project_id, data['userId']))
            else:
                abort(400, '角色无效')
        return jsonify(ok=True)

    @app.post('/api/projects/<project_id>/invite')
    def invite(project_id):
        data = body()
        email, role = str(data.get('email', '')).strip().lower(), data.get('role', 'editor')
        if '@' not in email or len(email) > 254 or role not in ('editor', 'viewer'):
            abort(400, '请填写有效邮箱与角色')
        token = secrets.token_urlsafe(32)
        with db.connect(write=True) as conn:
            access(conn, project_id, 'owner', lock=True)
            conn.execute('INSERT INTO invitations VALUES (?,?,?,?,?,?)', (hashed(token), project_id, email, role, int(time.time()) + 172800, g.user['id']))
        return jsonify(path='/join#' + token, expiresHours=48)

    @app.post('/api/invitations/accept')
    def accept_invite():
        data = body()
        token = str(data.get('token', ''))
        with db.connect(write=True) as conn:
            sql = 'SELECT * FROM invitations WHERE token_hash=? AND expires_at>?'
            if db.postgres:
                sql += ' FOR UPDATE'
            invitation = conn.one(sql, (hashed(token), int(time.time())))
            if not invitation:
                abort(400, '邀请无效、过期或已使用')
            existing = conn.one('SELECT * FROM users WHERE email=?', (invitation['email'],))
            if existing:
                if not g.user or existing['id'] != g.user['id']:
                    abort(403, '请先使用受邀邮箱登录，再打开邀请链接')
                user_id = existing['id']
            else:
                password = str(data.get('password', ''))
                name = str(data.get('name', '')).strip()[:100]
                if not 12 <= len(password) <= 256 or not name:
                    abort(400, '请填写姓名和至少 12 个字符的密码')
                user_id = uuid.uuid4().hex
                conn.execute('INSERT INTO users VALUES (?,?,?,?,?)', (user_id, invitation['email'], name, generate_password_hash(password), int(time.time())))
            conn.execute('INSERT INTO members VALUES (?,?,?) ON CONFLICT(project_id,user_id) DO NOTHING', (invitation['project_id'], user_id, invitation['role']))
            conn.execute('DELETE FROM invitations WHERE token_hash=?', (hashed(token),))
        response = start_session(user_id)
        return response

    @app.cli.command('reset-password')
    @click.argument('email')
    @click.password_option(confirmation_prompt=True)
    def reset_password(email, password):
        """Reset a user password from a trusted hosting shell."""
        if len(password) < 12:
            raise click.ClickException('Password must have at least 12 characters')
        with db.connect(write=True) as conn:
            user = conn.one('SELECT id FROM users WHERE email=?', (email.strip().lower(),))
            if not user:
                raise click.ClickException('User not found')
            conn.execute('UPDATE users SET password_hash=? WHERE id=?', (generate_password_hash(password), user['id']))
            conn.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        click.echo('Password changed and sessions revoked.')

    return app


def validate_review(value):
    if not isinstance(value, dict) or not isinstance(value.get('release', {}), dict) or not isinstance(value.get('items', {}), dict) or not isinstance(value.get('history', []), list):
        abort(400, '发布记录无效')
    if len(encode(value).encode()) > 800_000:
        abort(400, '发布记录超过 800 KB，请先导出历史并整理')
    for item in value.get('items', {}).values():
        if not isinstance(item, dict) or any(not isinstance(v, str) for v in item.values()):
            abort(400, '备注必须为文本')


def validate_permissions(value):
    if not isinstance(value, dict) or not isinstance(value.get('selected', []), list):
        abort(400, '权限配置无效')
    ids = {p['id'] for p in checklist.load_profiles().get('permissions', [])}
    if any(not isinstance(k, str) or k not in ids for k in value.get('selected', [])):
        abort(400, '包含未知权限')
    for key in ('descs', 'descsEn'):
        descriptions = value.get(key, {})
        if not isinstance(descriptions, dict) or any(not isinstance(v, str) or len(v) > 10000 for v in descriptions.values()):
            abort(400, '权限用途描述无效')
