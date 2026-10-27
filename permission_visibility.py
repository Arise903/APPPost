"""Permission applicability for checklist summaries and progress counts."""
import json
import re
from pathlib import Path


def annotate(sections):
    rules=json.loads(Path(__file__).with_name('permission_rules.json').read_text(encoding='utf-8'))
    for section in sections:
        group=None
        account_section=False
        for block in section['blocks']:
            if block['type'] in ('h3','h4'):
                group=next((g for g in rules['groups'] if re.search(g['heading'],block['title'])),None)
                account_section=bool(re.search(r'^(?:5\.4\s|账号注销与数据主体权利)',block['title']))
            if block['type']=='item' and account_section:
                block['cond']='hasAccountSystem'
            if block['type']=='item' and group:
                block['permissionRule']=next((r['requires'] for r in group['rules'] if r['contains'] in block['text']),group['default'])


def visible(rule,selected,profiles):
    if not rule:return True
    if isinstance(rule,list):return bool(set(rule)&set(selected))
    picked=[p for p in profiles.get('permissions',[]) if p['id'] in selected]
    if rule=='any':return bool(picked)
    if rule=='ios':return any(p['id']=='notifications' or (p.get('ios') or {}).get('infoplist_key') or (p.get('ios') or {}).get('infoplist_keys') for p in picked)
    if rule=='prompt':return any(p['id']=='notifications' or (p.get('ios') or {}).get('infoplist_key') or (p.get('ios') or {}).get('infoplist_keys') or (p.get('android') or {}).get('runtime') for p in picked)
    if rule=='iosUsage':return any((p.get('ios') or {}).get('infoplist_key') or (p.get('ios') or {}).get('infoplist_keys') for p in picked)
    if rule=='android':return any((p.get('android') or {}).get('manifest') for p in picked)
    if rule=='androidRuntime':return any((p.get('android') or {}).get('manifest') and (p.get('android') or {}).get('runtime') for p in picked)
    return False
