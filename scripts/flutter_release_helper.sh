#!/bin/bash
set -euo pipefail

TARGET="${1:-}"
if [[ "$TARGET" != "apk" && "$TARGET" != "aab" && "$TARGET" != "ios" ]]; then
  echo "用法：bash flutter_release_helper.sh {apk|aab|ios}" >&2
  exit 2
fi
if ! command -v flutter >/dev/null 2>&1; then
  echo "未找到 Flutter。请先安装 Flutter 并将 flutter 加入 PATH。" >&2
  exit 127
fi
if [[ ! -f pubspec.yaml ]]; then
  echo "请在 Flutter 工程根目录运行此脚本（未找到 pubspec.yaml）。" >&2
  exit 2
fi

case "$TARGET" in
  apk)
    flutter build apk --release
    echo "APK 已生成：build/app/outputs/flutter-apk/app-release.apk"
    ;;
  aab)
    flutter build aab --release
    echo "AAB 已生成：build/app/outputs/bundle/release/app-release.aab"
    ;;
  ios)
    if [[ "$(uname -s)" != "Darwin" ]]; then
      echo "iOS Archive 需要 macOS 与 Xcode；请在 Mac 上运行。" >&2
      exit 2
    fi
    flutter build ios
    WORKSPACE="$(find ios -maxdepth 1 -name '*.xcworkspace' -print -quit)"
    PROJECT="$(find ios -maxdepth 1 -name '*.xcodeproj' -print -quit)"
    if [[ -n "$WORKSPACE" ]]; then
      CONTAINER=(-workspace "$WORKSPACE")
    elif [[ -n "$PROJECT" ]]; then
      CONTAINER=(-project "$PROJECT")
    else
      echo "未在 ios/ 下找到 Xcode workspace 或 project。" >&2
      exit 2
    fi
    SCHEME="${FLUTTER_XCODE_SCHEME:-Runner}"
    ARCHIVE_PATH="${FLUTTER_ARCHIVE_PATH:-build/ios/archive/${SCHEME}.xcarchive}"
    if [[ -n "$WORKSPACE" ]]; then open -a Xcode "$WORKSPACE"; else open -a Xcode "$PROJECT"; fi
    echo "Xcode 已打开。请选择 Scheme: $SCHEME、Any iOS Device，然后通过 Product > Archive 完成归档。默认归档路径建议使用：$ARCHIVE_PATH"
    ;;
esac
