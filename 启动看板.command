#!/bin/bash
# 启动「上架前 App 配置清单」本地看板
# 用法：双击本文件即可（或在终端执行 ./启动看板.command）

cd "$(dirname "$0")" || exit 1

# 优先用 python3，退化到 python
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "找不到 python3，请先安装 Python 3。"
  read -r -p "按回车键关闭…" _
  exit 1
fi

# 找一个可用的 Python（Homebrew / python.org / Xcode CLT）
"$PY" - <<'PYCHECK' 2>/dev/null
import sys
sys.exit(0 if sys.version_info >= (3, 8) else 1)
PYCHECK
if [ $? -ne 0 ]; then
  echo "需要 Python 3.8 或更高版本，当前版本过低。"
  read -r -p "按回车键关闭…" _
  exit 1
fi

exec "$PY" checklist_tool.py serve "$@"
