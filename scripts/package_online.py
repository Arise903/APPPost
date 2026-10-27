"""Allowlisted source archive: excludes all runtime data and personal records."""
import argparse
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FILES=['启动看板.command','Dockerfile','.dockerignore','.gitignore','.env.example','render.yaml','requirements-online.txt','checklist_tool.py','storage_utils.py','board_template.html','board.js','board.css','permission_profiles.json','permission_rules.json','permission_visibility.js','permission_visibility.py','test_checklist.py','test_online.py','test_pages.cjs','PAGES.md','test_http_integration.py','run_online.py','README.md','DEPLOY.md','.github/workflows/online-ci.yml','docs/.nojekyll']
FILES += [str(p.relative_to(ROOT)) for parent in ('online','scripts','pages','docs') for p in (ROOT/parent).rglob('*') if p.is_file() and p.suffix in ('.py','.js','.css','.html','.md') and '__pycache__' not in p.parts]
parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=ROOT/'release-desk-source.zip');args=parser.parse_args()
with zipfile.ZipFile(args.out,'w',zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(set(FILES)):
        archive.write(ROOT/name,name)
print('已生成部署源码包：'+str(args.out.resolve()))
