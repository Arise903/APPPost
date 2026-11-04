'use strict';
const script=`#!/bin/bash
set -euo pipefail
TARGET="\${1:-}"
if [[ "$TARGET" != "apk" && "$TARGET" != "aab" && "$TARGET" != "ios" ]]; then echo "用法：bash flutter_release_helper.sh {apk|aab|ios}" >&2; exit 2; fi
if ! command -v flutter >/dev/null 2>&1; then echo "未找到 Flutter，请先安装并配置 PATH。" >&2; exit 127; fi
if [[ ! -f pubspec.yaml ]]; then echo "请在 Flutter 工程根目录运行（未找到 pubspec.yaml）。" >&2; exit 2; fi
case "$TARGET" in
 apk) flutter build apk --release; echo "APK: build/app/outputs/flutter-apk/app-release.apk" ;;
 aab) flutter build aab --release; echo "AAB: build/app/outputs/bundle/release/app-release.aab" ;;
 ios)
  [[ "$(uname -s)" == "Darwin" ]] || { echo "iOS Archive 需要 macOS 与 Xcode。" >&2; exit 2; }
  flutter build ios
  WORKSPACE="$(find ios -maxdepth 1 -name '*.xcworkspace' -print -quit)"; PROJECT="$(find ios -maxdepth 1 -name '*.xcodeproj' -print -quit)"
  if [[ -n "$WORKSPACE" ]]; then CONTAINER=(-workspace "$WORKSPACE"); elif [[ -n "$PROJECT" ]]; then CONTAINER=(-project "$PROJECT"); else echo "ios/ 下未找到 Xcode workspace 或 project。" >&2; exit 2; fi
  SCHEME="\${FLUTTER_XCODE_SCHEME:-Runner}"; ARCHIVE_PATH="\${FLUTTER_ARCHIVE_PATH:-build/ios/archive/\${SCHEME}.xcarchive}"
  if [[ -n "$WORKSPACE" ]]; then open -a Xcode "$WORKSPACE"; else open -a Xcode "$PROJECT"; fi
  echo "Xcode 已打开。请选择 Scheme: $SCHEME、Any iOS Device，然后通过 Product > Archive 完成归档。" ;;
esac
`;
const helper=`# Flutter 发布打包工具

请先解压到 Flutter 工程根目录，然后打开终端在该目录运行。脚本只在本机执行，不会上传工程或自动发布到商店。

- Android APK：\`bash flutter_release_helper.sh apk\`，执行 \`flutter build apk --release\`
- Android AAB：\`bash flutter_release_helper.sh aab\`，执行 \`flutter build aab --release\`
- iOS：\`bash flutter_release_helper.sh ios\`，先执行 \`flutter build ios\`，完成后打开 Xcode，请选择 Release Scheme、Any iOS Device，再通过 Product > Archive 手动归档。

iOS 需要 macOS 与 Xcode。脚本默认 Scheme 为 Runner；多 Scheme 工程可设置 \`FLUTTER_XCODE_SCHEME\`。签名、Team、Bundle Identifier 与导出合规项请在 Xcode 中核对。
`;
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
window.FlutterBuildHelper={download(){download('flutter_release_helper.sh',script,'text/x-shellscript;charset=utf-8');download('Flutter-发布打包说明.md',helper,'text/markdown;charset=utf-8');}};
