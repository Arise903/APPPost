"""Generate a searchable standalone comparison of extracted branch configurations."""
import argparse
import html
import json
from pathlib import Path
from extract_flutter_config import Repo, extract


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    configs = [extract(Repo(args.repo, branch), platform) for branch, platform in [('feature-iOS', 'iOS'), ('android', 'Android')]]
    maps = [dict(config.rows) for config in configs]
    rows = []
    for key in dict.fromkeys([*maps[0], *maps[1]]):
        left, right = [values.get(key, '未发现') for values in maps]
        different = left != right
        cells = ''.join('<td><pre>' + html.escape(value) + '</pre></td>' for value in (left, right))
        rows.append('<tr data-different="' + str(different).lower() + '"><th>' + html.escape(key) + '</th>' + cells + '</tr>')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Cleanwave 分支配置对比</title><style>body{font:14px system-ui;margin:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:10px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}tr[data-different=true]{background:#fff8df}input{padding:10px;margin:12px}</style><h1>Cleanwave 分支配置对比</h1><p>黄色表示差异。源码声明不代表最终生效值；环境覆盖与商店后台需另行核对。</p><input id="search" placeholder="搜索配置和值"><label><input id="diff" type="checkbox">只看差异</label><table><thead><tr><th>配置项 / 来源</th><th>feature-iOS</th><th>android</th></tr></thead><tbody>''' + ''.join(rows) + '''</tbody></table><script>function filter(){for(const r of document.querySelectorAll('tbody tr'))r.hidden=!r.textContent.toLowerCase().includes(search.value.toLowerCase())||(diff.checked&&r.dataset.different!=='true')}search.oninput=diff.onchange=filter;</script></html>''', encoding='utf-8')
    evidence = {branch: {'commit': Repo(args.repo, branch).head(), 'platform': platform, 'status': '静态声明，运行时生效状态待核对', 'configuration': dict(config.rows), 'release': config.release} for (branch, platform), config in zip([('feature-iOS', 'iOS'), ('android', 'Android')], configs)}
    args.out.with_suffix('.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
