"""Build a self-contained personal Pages edition from public templates only."""
import hashlib
import re
import json
import shutil
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import checklist_tool as c
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs'

# 与 board/edition.js 的默认文案对应；只覆盖 Pages 版本需要不同的条目。
PAGES_STRINGS={
    'connectedBadge':'Pages 个人版 · 保存到当前浏览器',
    'connectedStatus':'已连接本机存储 · 世代 {gen} · 勾选可直接写回 md',
    'connectedToast':'本机存储已就绪；请定期导出完整记录',
    'saveTitle':'保存检查进度到当前浏览器？',
    'saveKeepNote':'项目保存在当前浏览器，不会上传 GitHub。',
    'saveDetail':'保存前保留本机项目快照；请定期从工作台导出完整记录。',
    'savedToast':'已保存到当前浏览器',
    'clearRewrite':'浏览器中的项目记录会更新',
    'clearDetail':'操作前保留完整本机快照。清理网站数据会删除项目和快照，请先导出备份。',
}


def build():
    OUT.mkdir(exist_ok=True)
    inputs=[ROOT/'release_config_fields.json',ROOT/'checklist_modules.json',ROOT/'board.js',ROOT/'release_readiness.js',ROOT/'release_analysis.js',*sorted((ROOT/'board').glob('*.js')),ROOT/'board.css',ROOT/'board_template.html',ROOT/'permission_rules.json',ROOT/'permission_visibility.js',ROOT/'permission_profiles.json',ROOT/'online/default_checklist.md',ROOT/'online/static/app.css',Path(__file__),*sorted(path for path in (ROOT/'pages').glob('*') if path.suffix in ('.js','.html','.css'))]
    digest=hashlib.sha256()
    for path in inputs:
        if path.is_file(): digest.update(path.read_bytes())
    version=digest.hexdigest()[:12]
    template_version=hashlib.sha256((ROOT/'online/default_checklist.md').read_bytes()).hexdigest()[:10]
    for name in ('index.html','dashboard.js','store.js','vault.js','vault-ui.js','github-sync.js','guide.html','guide.js','experience.js','history.js','history.css','enhancements.css','storage.js','bootstrap.js','templates.js','workflows.js','workflows.css','project-import.js'):
        shutil.copyfile(ROOT/'pages'/name,OUT/name)
    shutil.copyfile(ROOT/'online/static/app.css',OUT/'app.css')
    shutil.copyfile(ROOT/'permission_visibility.js',OUT/'permission_visibility.js')
    shutil.copyfile(ROOT/'release_readiness.js',OUT/'release_readiness.js')
    shutil.copyfile(ROOT/'release_analysis.js',OUT/'release_analysis.js')
    data={'configFields':json.loads((ROOT/'release_config_fields.json').read_text(encoding='utf-8')),'modules':c.load_checklist_modules(),'document':(ROOT/'online/default_checklist.md').read_text(encoding='utf-8'),'profiles':c.load_profiles(),'rules':json.loads((ROOT/'permission_rules.json').read_text(encoding='utf-8')),'version':version,'templateVersion':template_version,'permissionsVersion':hashlib.sha256((ROOT/'permission_profiles.json').read_bytes()).hexdigest()[:10]}
    (OUT/'data.js').write_text('const PAGES_DATA = '+json.dumps(data,ensure_ascii=False).replace('</','<\\/')+';\n',encoding='utf-8')
    page=(ROOT/'board_template.html').read_text(encoding='utf-8')
    # 版本差异走运行时开关：文案与存储作用域都在源码内，构建只做注入。
    js=('const PAGES_STRINGS = '+json.dumps(PAGES_STRINGS,ensure_ascii=False)+';\n'
        'window.BOARD_STRINGS = PAGES_STRINGS;\n'
        'document.getElementById("pagesProjectName").textContent=PagesStore.get(PagesStore.projectId()).name;\n'
        +c.load_board_js())
    page=page.replace('__PERMISSION_RULES__',(ROOT/'permission_rules.json').read_text(encoding='utf-8')).replace('__PERMISSION_VISIBILITY__',(ROOT/'permission_visibility.js').read_text(encoding='utf-8')).replace('__BOARD_CSS__',(ROOT/'board.css').read_text(encoding='utf-8')).replace('__BOARD_JS__',js)
    page=page.replace('const EMBEDDED = __DATA__;','const EMBEDDED = PagesStore.openProject();').replace('const EMBEDDED_PROFILES = __PROFILES__;','const EMBEDDED_PROFILES = PAGES_DATA.profiles;').replace('__TITLE__','检查项目 · Pages 个人版')
    page=page.replace('<script>\nconst PERMISSION_RULES', '<script type="text/plain" id="pagesBoardSource">\nconst PERMISSION_RULES').replace('</body>', '<script defer src="bootstrap.js"></script></body>')
    page=page.replace('<head>','<head>\n<script src="data.js"></script><script src="release_analysis.js"></script><script src="vault.js"></script><script src="storage.js"></script><script src="store.js"></script><script>PagesStore.install();</script><script defer src="vault-ui.js"></script><script defer src="experience.js"></script><link rel="stylesheet" href="history.css"><script defer src="history.js"></script><link rel="stylesheet" href="workflows.css"><script defer src="workflows.js"></script>')
    page=page.replace('<body>','<body><nav class="workspace-topbar"><a href="index.html">← 我的项目</a><span id="pagesProjectName"></span><span class="workspace-local">本机工作台</span></nav>')
    page=page.replace('勾选状态保存在本机浏览器 · 需要写回文件请使用本地服务模式','所有记录保存在当前浏览器 · 换设备或清理网站数据前请导出完整 JSON')
    unresolved=re.findall(r'__[A-Z][A-Z_]+__',page)
    if unresolved: raise ValueError('Unresolved Pages placeholders: '+', '.join(sorted(set(unresolved))))
    (OUT/'board.html').write_text(page,encoding='utf-8')
    for target in OUT.glob('*.html'):
        html=target.read_text(encoding='utf-8')
        html=re.sub(r'(src|href)="([A-Za-z_-]+\.(?:js|css))"',lambda m:m[1]+'="'+m[2]+'?v='+version+'"',html)
        target.write_text(html,encoding='utf-8')
    (OUT/'version.json').write_text(json.dumps({'version':version,'templateVersion':template_version}))
    (OUT/'.nojekyll').write_text('')
    print('Pages 个人版已生成：'+str(OUT))

if __name__=='__main__':build()
