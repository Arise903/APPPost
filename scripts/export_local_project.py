"""Export private local records without placing them in the source repository."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import checklist_tool as c
from storage_utils import load_review

parser=argparse.ArgumentParser()
parser.add_argument('--md',required=True,type=Path)
parser.add_argument('--out',required=True,type=Path)
args=parser.parse_args()
selected,descs,descs_en=c.read_perm_state(args.md)
data={'format':'release-desk/v1','name':args.md.stem,'document':args.md.read_text(encoding='utf-8'),'permissions':{'selected':selected,'descs':descs,'descsEn':descs_en},'review':load_review(args.md)}
args.out.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
args.out.chmod(0o600)
print('已导出到：'+str(args.out.resolve()))
