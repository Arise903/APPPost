"""Local service end-to-end checks: every /api endpoint plus static file rules."""
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import checklist_tool as c
import tempfile
import threading
import json
import http.client
from pathlib import Path


def main():
    with tempfile.TemporaryDirectory() as tmp:
        md = Path(tmp) / 'test.md'
        md.write_text('# Demo\n\n## Tasks\n- [ ] First\n- [ ] Second\n')
        c.STATE_FILE = Path(tmp) / 'generation.json'
        c.EN_DOC_FILE = Path(tmp) / 'Privacy-and-Permissions-EN.md'
        srv = c.ThreadingHTTPServer(('127.0.0.1', 0), c.make_handler())
        srv.md_path = md
        srv.html_path = md.with_suffix('.html')
        passed = []

        def check(name, condition):
            if not condition:
                raise AssertionError(name)
            passed.append(name)

        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()

        def req(path, body=None, origin=None):
            conn = http.client.HTTPConnection('127.0.0.1', srv.server_port)
            headers = {'Content-Type': 'application/json'}
            if origin:
                headers['Origin'] = origin
            conn.request('GET' if body is None else 'POST', path, None if body is None else json.dumps(body), headers)
            response = conn.getresponse()
            raw = response.read()
            conn.close()
            return response.status, json.loads(raw) if path.startswith('/api/') else raw

        try:
            # --- 读取与门禁 ---
            status, data = req('/api/list')
            check('list', status == 200 and not data['gateDone'])
            check('write blocked before guide ack', req('/api/write', {'revision': data['revision'], 'states': {data['items'][0]['id']: 'done'}})[0] == 403)
            check('health', req('/api/health')[1]['ok'])
            check('profiles', len(req('/api/profiles')[1]['permissions']) > 0)

            status, data = req('/api/ack', {})
            check('ack', status == 200 and data['gateDone'])
            revision, item = data['revision'], data['items'][0]['id']

            # --- 保存与冲突 ---
            status, saved = req('/api/write', {'revision': revision, 'states': {item: 'done'}})
            check('write', status == 200 and saved['saved'])
            check('stale write', req('/api/write', {'revision': revision, 'states': {item: 'todo'}})[0] == 409)
            check('stale clear', req('/api/clear', {'revision': revision})[0] == 409)
            check('cross origin', req('/api/write', {'revision': saved['revision'], 'states': {}}, 'https://example.com')[0] == 403)
            check('invalid states', req('/api/write', {'revision': saved['revision'], 'states': {item: 'bogus'}})[0] == 400)

            # --- 备注、备份与恢复 ---
            status, review = req('/api/review', {'revision': saved['revision'], 'review': {'release': {'version': '1'}, 'items': {item: {'reason': 'verified', 'notes': 'OK', 'evidence': 'screen.png'}}, 'history': []}})
            check('review', status == 200 and review['review']['items'][item]['notes'] == 'OK')
            status, backups = req('/api/backups', {})
            check('backups', status == 200 and backups['backups'])
            check('restore traversal', req('/api/restore', {'revision': review['revision'], 'name': '../../x'})[0] == 400)
            status, restored = req('/api/restore', {'revision': review['revision'], 'name': backups['backups'][0]})
            check('restore', status == 200 and restored['items'][0]['state'] == 'todo')

            # --- 项目特征、订阅、权限配置 ---
            check('stale features', req('/api/features', {'revision': review['revision'], 'features': {}})[0] == 409)
            status, features = req('/api/features', {'revision': restored['revision'], 'features': {'hasSubscriptions': False}})
            check('features', status == 200 and 'changed' in features)
            check('invalid subscriptions', req('/api/subscriptions', {'revision': features['revision'], 'enabled': 'yes', 'products': []})[0] == 400)
            status, subscriptions = req('/api/subscriptions', {'revision': features['revision'], 'enabled': False, 'products': []})
            check('subscriptions', status == 200 and subscriptions['review']['subscriptions'] == [])

            selection = {'selected': ['camera'], 'descs': {}, 'descsEn': {}}
            status, config = req('/api/perm-config', dict(selection))
            check('perm config', status == 200 and config['iosPlist'] and 'PERMISSION_APPENDIX' in config['appendix'])
            check('perm english preview', status == 200 and req('/api/perm-en-preview', dict(selection))[1]['doc'].startswith('#'))
            status, written = req('/api/perm-write', {'revision': subscriptions['revision'], **selection})
            check('perm write', status == 200 and 'PERMISSION_APPENDIX' in written['mdText'] and written['saved'])
            status, english = req('/api/perm-write-en', dict(selection))
            check('perm write english', status == 200 and english['saved'] and Path(c.EN_DOC_FILE).exists())

            # --- 重新加载、取消确认、未知路径 ---
            check('reload', req('/api/reload', {})[0] == 200)
            status, unacked = req('/api/unack', {})
            check('unack', status == 200 and not unacked['gateDone'])
            check('unknown api', req('/api/nope', {})[0] == 404)

            # --- 静态资源：清单可见，隐藏记录不可见 ---
            check('board html', req('/')[0] == 200)
            check('markdown served', req('/test.md')[0] == 200)
            check('dotfile blocked', req('/.test.review.json')[0] == 404)
            check('backup file blocked', req('/' + backups['backups'][0])[0] == 404)
            check('invalid payload', req('/api/write', [])[0] == 400)

            print('HTTP integration: ' + ', '.join(passed) + ': %d passed' % len(passed))
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    main()
