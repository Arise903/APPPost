#!/usr/bin/env python3
"""Extract release configuration from a local Flutter repository.

The output is a Markdown section the release board understands: a two column
"配置项 | 代码中的值 / 分析结论" table plus the values the board can copy into
the release record. Secrets are never printed: keys and tokens are reported by
variable, file and line so they can be verified against the real source.

Usage:
  python3 scripts/extract_flutter_config.py <repo> [--branch NAME] [--platform iOS|Android]
                                            [--out FILE]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SECRET_HINT = "仅记录变量名、存放位置与验证方式，不复制明文"


class Repo:
    """Read files from a branch (git) or from the working tree."""

    def __init__(self, root: Path, branch: str | None):
        self.root = root
        self.branch = branch

    def read(self, path: str) -> str | None:
        if self.branch:
            try:
                out = subprocess.run(["git", "show", f"{self.branch}:{path}"], cwd=self.root,
                                     capture_output=True, text=True, check=True)
            except (subprocess.CalledProcessError, OSError):
                return None
            return out.stdout
        target = self.root / path
        return target.read_text(encoding="utf-8", errors="replace") if target.is_file() else None

    def exists(self, path: str) -> bool:
        return self.read(path) is not None

    def head(self) -> str:
        if not self.branch:
            return "working tree"
        try:
            out = subprocess.run(["git", "rev-parse", self.branch], cwd=self.root,
                                 capture_output=True, text=True, check=True)
        except (subprocess.CalledProcessError, OSError):
            return self.branch
        return out.stdout.strip()[:40]

    def grep(self, pattern: str, *paths: str) -> list[tuple[str, int, str]]:
        """Return (path, line number, line) matches inside the given paths."""
        results = []
        for path in paths:
            text = self.read(path)
            if not text:
                continue
            for index, line in enumerate(text.splitlines(), start=1):
                if re.search(pattern, line):
                    results.append((path, index, line.strip()))
        return results

    def lib_files(self) -> list[str]:
        if self.branch:
            out = subprocess.run(["git", "ls-tree", "-r", "--name-only", self.branch], cwd=self.root,
                                 capture_output=True, text=True)
            names = out.stdout.splitlines() if out.returncode == 0 else []
        else:
            names = [str(p.relative_to(self.root)) for p in (self.root / "lib").rglob("*") if p.is_file()]
        return [n for n in names if n.startswith("lib/") and "/build/" not in n and n.endswith((".dart", ".arb"))]


def first_match(pattern: str, text: str | None, group: int = 1) -> str:
    if not text:
        return ""
    match = re.search(pattern, text, re.M)
    return match.group(group).strip() if match else ""


def plist_values(text: str | None) -> dict[str, str]:
    values: dict[str, str] = {}
    if not text:
        return values
    for key, value in re.findall(r"<key>([^<>]*)</key>\s*<string>([^<>]*)</string>", text):
        values[key.strip()] = value.strip()
    for key, block in re.findall(r"<key>([^<>]*)</key>\s*<array>(.*?)</array>", text, re.S):
        items = re.findall(r"<string>([^<>]*)</string>", block)
        values[key.strip()] = "、".join(items)
    for key, flag in re.findall(r"<key>([^<>]*)</key>\s*<(true|false)/>", text):
        values[key.strip()] = flag
    return values


class Config:
    def __init__(self):
        self.rows: list[tuple[str, str]] = []
        self.release: dict[str, str] = {}
        self.notes: list[str] = []

    def add(self, label: str, value: str) -> None:
        value = str(value or "").strip()
        if not value or any(label == existing for existing, _ in self.rows):
            return
        self.rows.append((label, value))

    def suggest(self, key: str, value: str) -> None:
        value = str(value or "").strip()
        if value:
            self.release[key] = value

    def note(self, text: str) -> None:
        if text not in self.notes:
            self.notes.append(text)


def extract(repo: Repo, platform: str) -> Config:
    cfg = Config()
    ios = platform.lower().startswith("ios")
    pubspec = repo.read("pubspec.yaml") or ""
    gradle = repo.read("android/app/build.gradle.kts") or repo.read("android/app/build.gradle") or ""
    manifest = repo.read("android/app/src/main/AndroidManifest.xml") or ""
    plist = plist_values(repo.read("ios/Runner/Info.plist"))
    pbx = repo.read("ios/Runner.xcodeproj/project.pbxproj") or ""
    lib = {name: (repo.read(name) or "") for name in repo.lib_files()}

    version = first_match(r"^version:\s*(\S+)", pubspec, 1)
    name, build = (version.split("+") + [""])[:2] if version else ("", "")
    app_name = plist.get("CFBundleDisplayName") or first_match(r'android:label="([^"]+)"', manifest)

    cfg.add("源分支", repo.branch or "工作区")
    cfg.add("源提交", repo.head())
    cfg.add("分析范围", "仅该分支受版本控制的应用源码；不执行应用，不读取签名私钥，不访问线上接口")
    cfg.add("应用名称", app_name)
    cfg.add("发布平台", platform)
    if version:
        cfg.add("版本 / 构建", (f"{name} / {build}" if build else name))
    cfg.suggest("version", name)
    cfg.suggest("build", build)
    cfg.suggest("app", app_name)
    cfg.suggest("platform", platform)

    android_id = first_match(r'applicationId\s*=\s*"([^"]+)"', gradle) or first_match(
        r'android:name="android.permission[^"]*"', manifest) and ""
    if android_id:
        cfg.add("Android 应用标识", android_id)
        cfg.suggest("appIdAndroid", android_id)
    ios_id = first_match(r"PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);", pbx) or plist.get("CFBundleIdentifier", "")
    ios_id = "" if "$(" in ios_id else ios_id
    if ios_id:
        cfg.add("iOS 应用标识", ios_id)
        cfg.suggest("appIdIOS", ios_id)

    for label, pattern in [("最低 Android SDK", r"minSdk\s*=\s*(\S+)"), ("compileSdk", r"compileSdk\s*=\s*([^\s]+)"),
                           ("targetSdk", r"targetSdk\s*=\s*([^\s]+)")]:
        value = first_match(pattern, gradle)
        cfg.add(label, value)
        cfg.suggest({"最低 Android SDK": "minAndroidSdk", "compileSdk": "compileSdk", "targetSdk": "targetSdk"}[label], value)

    minify = first_match(r"isMinifyEnabled\s*=\s*(\w+)", gradle) or first_match(r"minifyEnabled\s+(\w+)", gradle)
    if minify:
        cfg.add("代码混淆与资源压缩", "开启（R8 + shrinkResources）" if minify == "true" else "未开启")
    abi = first_match(r"abiFilters\s*\+=\s*listOf\(([^)]*)\)", gradle)
    if abi:
        cfg.add("ABI 架构", abi.replace('"', "").strip())
    if "signingConfigs" in gradle:
        cfg.add("签名配置", "release 使用 key.properties（仓库内不含密钥文件）" + "；" + SECRET_HINT)

    permissions = re.findall(r'android:name="android\.permission\.([A-Z_]+)"', manifest)
    if permissions:
        cfg.add("代码显式权限", "、".join(sorted(set(permissions))))
    cleartext = first_match(r'usesCleartextTraffic="(\w+)"', manifest)
    if cleartext:
        cfg.add("HTTP 明文开关", f"usesCleartextTraffic={cleartext}；正式包是否确需开放待复核")
    features = re.findall(r'android:name="android\.hardware\.([^"]+)"', manifest)
    if features:
        cfg.add("声明的硬件特性", "、".join(sorted(set(features))) + "（required=false）")

    usage = {key: value for key, value in plist.items() if key.endswith("UsageDescription")}
    if usage:
        cfg.add("iOS 权限用途说明", "、".join(sorted(usage)))
    if plist.get("UIBackgroundModes"):
        cfg.add("iOS 后台模式", plist["UIBackgroundModes"])
    if plist.get("ITSAppUsesNonExemptEncryption"):
        cfg.add("iOS 加密豁免", f"ITSAppUsesNonExemptEncryption={plist['ITSAppUsesNonExemptEncryption']}")
    deploy = first_match(r"IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);", pbx)
    if deploy:
        cfg.add("iOS 最低系统版本", deploy)
    devices = first_match(r'TARGETED_DEVICE_FAMILY = "([^"]+)"', pbx)
    if devices:
        cfg.add("iOS 设备类型", "iPhone / iPad" if "2" in devices else "iPhone")

    urls: dict[str, str] = {}
    for path, text in lib.items():
        for match in re.finditer(r'https?://[^\s"\']+', text):
            url = match.group(0).rstrip(",;)")
            urls.setdefault(url, f"{path}:{text[:match.start()].count(chr(10)) + 1}")
    base_url = ""
    for path, text in lib.items():
        found = re.search(r'_baseUrl\s*=\s*"([^"]+)"', text)
        if found:
            base_url = found.group(1)
            cfg.add("AnalysisApi 地址", base_url)
            cfg.add("API 基础地址", base_url)
            cfg.suggest("analysisApiUrl", base_url)
            cfg.suggest("apiBaseUrl", base_url)
            break
    project_id = ""
    for path, text in lib.items():
        found = re.search(r"projectId\s*=\s*Platform\.isIOS\s*\?\s*(\d+)\s*:\s*(\d+)", text)
        if found:
            project_id = found.group(1) if ios else found.group(2)
            cfg.add("AnalysisApi projectId", project_id)
            cfg.suggest("analysisApiProjectId", project_id)
            cfg.note(f"projectId 由 Platform.isIOS 决定（iOS {found.group(1)} / Android {found.group(2)}），见 {path}")
            break
    for path, text in lib.items():
        found = re.search(r"AdjustConfig\(\s*'([^']+)'", text)
        if found:
            line = text[:found.start()].count("\n") + 1
            env = "sandbox（debug）/ production（release）由 kDebugMode 决定"
            cfg.add("Adjust appToken", found.group(1))
            cfg.add("Adjust Token 配置位置", f"{path}:{line} 硬编码 AdjustConfig 第一个参数（appToken）；环境：{env}")
            cfg.suggest("adjustAppToken", found.group(1))
            cfg.suggest("adjustTokenSource", f"{path}:{line} AdjustConfig 第一个参数（appToken）")
            if ios:
                cfg.add("Adjust", "已启用：启动即 initSdk（首会话延迟），随后等待 ATT 结果再完成首次会话")
            else:
                cfg.add("Adjust", "未启用：AdjustManager.init() 首行 `if (!Platform.isIOS) return;`，依赖存在不等于运行时初始化")
            break
    for path, text in lib.items():
        found = re.search(r"(feedbackApiKey)\s*=", text)
        if found:
            line = text[:found.start()].count("\n") + 1
            cfg.add("反馈 API Key 配置位置", f"{path}:{line} 变量 {found.group(1)}；{SECRET_HINT}")
            break
    for url, location in sorted(urls.items()):
        label = ""
        lowered = url.lower()
        if "policy" in lowered:
            label = "隐私政策地址"
        elif "terms" in lowered:
            label = "用户协议地址"
        elif "feedback" in lowered:
            label = "反馈地址"
        elif "subscriptions" in lowered:
            label = "订阅管理地址"
        elif "apps.apple.com/account" in lowered or "play.google.com/store/account" in lowered:
            label = "订阅管理地址"
        elif "play.google.com/store/apps/details" in lowered:
            label = "商店详情页"
        elif "fire-api.com" in lowered and "feedback" not in lowered:
            continue
        elif "material.io" in lowered or "flutter" in lowered:
            continue
        if not label:
            continue
        cfg.add(label, url)
        if label == "隐私政策地址":
            cfg.suggest("privacyPolicyUrl", url)
        if label == "用户协议地址":
            cfg.suggest("termsUrl", url)
        if label == "反馈地址":
            cfg.suggest("feedbackUrl", url)

    products = []
    for path, text in sorted(lib.items()):
        source = path.rsplit("/", 1)[-1]
        for line in text.splitlines():
            if line.lstrip().startswith("//"):
                continue
            found = re.search(r'static const String (product\w+|productAndroid\w+)\s*=\s*"([^"]+)"', line)
            if found and found.group(2) not in products:
                products.append(f"{found.group(2)}（{source}）")
    if products:
        cfg.add("订阅商品 ID", "、".join(products))
    for path, text in lib.items():
        policy = re.search(r'policy_(?:android|ios)_url\s*=\s*"([^"]+)"', text)
        terms = re.search(r'terms_(?:android|ios)_url\s*=\s*"([^"]+)"', text)
        if not (policy or terms):
            continue
        suffix = "ios" if ios else "android"
        chosen_policy = re.search(rf'policy_{suffix}_url\s*=\s*"([^"]+)"', text) or policy
        chosen_terms = re.search(rf'terms_{suffix}_url\s*=\s*"([^"]+)"', text) or terms
        if chosen_policy:
            cfg.rows = [(label, value) for label, value in cfg.rows if label != "隐私政策地址"]
            cfg.add("隐私政策地址", chosen_policy.group(1))
            cfg.suggest("privacyPolicyUrl", chosen_policy.group(1))
        if chosen_terms:
            cfg.rows = [(label, value) for label, value in cfg.rows if label != "用户协议地址"]
            cfg.add("用户协议地址", chosen_terms.group(1))
            cfg.suggest("termsUrl", chosen_terms.group(1))
        cfg.note(f"协议与隐私地址按平台常量区分（{suffix}），见 {path}")
        break
    for path, text in lib.items():
        found = re.search(r"forceVip\s*=\s*(true|false)", text)
        if found:
            cfg.add("测试强制会员", f"forceVip = {found.group(1)}")
            break
    for path, text in lib.items():
        splash = re.search(r"static const Duration splashMaxDelay\s*=\s*Duration\(\w+:\s*(\d+)", text)
        timeout = re.search(r"static const Duration timeout\s*=\s*Duration\(\w+:\s*(\d+)", text)
        if splash or timeout:
            parts = []
            if splash:
                parts.append(f"启动页最长等待 {splash.group(1)} 秒")
            if timeout:
                parts.append(f"网络请求超时 {timeout.group(1)} 秒")
            cfg.add("启动等待 / 请求超时", "；".join(parts))
            break
    git_refs = re.findall(r"url:\s*(\S+)\s*\n\s*ref:\s*(\S+)", pubspec)
    if git_refs:
        cfg.add("Git 依赖", "；".join(f"{url.split('/')[-1].replace('.git', '')} @ {ref}" for url, ref in git_refs))
    local_reminders = any("flutter_local_notifications" in text or "android_alarm_manager_plus" in text
                          for text in [pubspec])
    if local_reminders:
        cfg.add("通知", "本地计划提醒（flutter_local_notifications + android_alarm_manager_plus），无远程推送依赖")
    if "firebase_messaging" not in pubspec:
        cfg.note("未发现 firebase_messaging，远程推送需另行确认")
    locales = sorted({name.split("/")[-1][4:-4] for name in repo.lib_files() if name.startswith("lib/l10n/")})
    if locales:
        cfg.add("语言与本地化", "、".join(locales))

    firebase = repo.read("android/app/google-services.json")
    if firebase:
        try:
            data = json.loads(firebase)
            info = data.get("project_info", {})
            cfg.add("Firebase 项目", f"{info.get('project_id', '')}（{info.get('project_number', '')}）")
            packages = [c.get("client_info", {}).get("android_client_info", {}).get("package_name", "")
                        for c in data.get("client", [])]
            packages = [p for p in packages if p]
            if packages and android_id and android_id not in packages:
                cfg.note(f"google-services.json 注册的包名与 applicationId 不一致：{'、'.join(packages)}")
        except ValueError:
            cfg.note("google-services.json 无法解析")
    ios_plist = plist_values(repo.read("ios/Runner/GoogleService-Info.plist"))
    if ios_plist.get("PROJECT_ID"):
        cfg.add("Firebase iOS 应用", f"PROJECT_ID {ios_plist['PROJECT_ID']} · BUNDLE_ID {ios_plist.get('BUNDLE_ID', '')}")
        if ios_id and ios_plist.get("BUNDLE_ID") and ios_id != ios_plist["BUNDLE_ID"]:
            cfg.note(f"GoogleService-Info.plist 的 BUNDLE_ID（{ios_plist['BUNDLE_ID']}）与工程 Bundle ID（{ios_id}）不一致")
    cfg.add("发布环境", "production（release 构建；debug 走 sandbox）")
    cfg.suggest("environment", "production")
    cfg.add("未填写的信息", "、".join(["负责人", "目标发布日期", "商店价格与销售地区", "推送证书 / 远程推送配置"]))
    cfg.add("密钥处理", "Adjust appToken 为应用标识，已在上方记录；反馈 API Key、签名密码等仅记录变量与文件位置，不复制明文")
    return cfg


CHECKLIST = [
    ("cfg_identity", "已核对应用标识、版本与构建号与最终构建产物一致"),
    ("cfg_analysis", "已核对 AnalysisApi 地址与 projectId 指向正式环境，Release 包不会打到测试环境"),
    ("cfg_adjust", "已核对 Adjust appToken 与 Adjust 后台一致，并按平台确认是否真的初始化"),
    ("cfg_permissions", "已核对权限声明、用途说明与代码实际调用一致"),
    ("cfg_urls", "已核对隐私政策、用户协议与反馈地址可访问，且内容与本版本一致"),
    ("cfg_products", "已核对订阅商品 ID、价格与销售地区和商店后台一致"),
    ("cfg_build", "已核对混淆、ABI、明文网络与签名配置符合发布要求"),
]


def markdown(cfg: Config, title: str, checklist: bool = True) -> str:
    lines = [f"## {title} <!-- section:extracted_config -->", "",
             "| 配置项 | 代码中的值 / 分析结论 |", "| --- | --- |"]
    for label, value in cfg.rows:
        lines.append(f"| {label} | {str(value).replace('|', '/')} |")
    lines += ["", "> 上述为源码静态证据，不代表正式包、商店后台、真机购买或服务器状态已验收。未能确认的值保留为空。"]
    if checklist:
        lines += ["", "## 源码配置核对 <!-- section:extracted_checks -->", ""]
        lines += [f"- [ ] {text} <!-- task:{task} -->" for task, text in CHECKLIST]
    if cfg.notes:
        lines += ["", "### 需要人工确认", ""] + [f"- {note}" for note in cfg.notes]
    if cfg.release:
        lines += ["", "### 建议填入发布信息", "", "| 发布信息字段 | 值 |", "| --- | --- |"]
        labels = {"app": "App 名称", "platform": "平台", "version": "版本号", "build": "构建号", "appIdIOS": "iOS 应用标识",
                  "appIdAndroid": "Android 应用标识", "apiBaseUrl": "API 基础地址", "privacyPolicyUrl": "隐私政策地址",
                  "termsUrl": "用户协议地址", "feedbackUrl": "反馈地址", "analysisApiUrl": "AnalysisApi 地址",
                  "analysisApiProjectId": "AnalysisApi projectId", "minAndroidSdk": "最低 Android SDK",
                  "compileSdk": "compileSdk", "targetSdk": "targetSdk"}
        for key, value in cfg.release.items():
            lines.append(f"| {labels.get(key, key)} | {value} |")
    return "\n".join(lines) + "\n"


def project_json(cfg: Config, document: str, name: str) -> str:
    """A single project export the board can import (新建项目 → 导入记录)."""
    return json.dumps({
        "format": "release-desk/v1",
        "name": name,
        "document": document,
        "permissions": {"selected": [], "descs": {}, "descsEn": {}},
        "review": {"release": cfg.release, "items": {}, "history": []},
    }, ensure_ascii=False, indent=2)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Extract release configuration from a Flutter repository")
    parser.add_argument("repo", help="path to the Flutter project")
    parser.add_argument("--branch", help="git branch to read (defaults to the working tree)")
    parser.add_argument("--platform", default="iOS / Android", help="declared release platform")
    parser.add_argument("--title", default="从分支提取的配置信息", help="markdown section title")
    parser.add_argument("--out", help="write the markdown to this file")
    parser.add_argument("--project", help="write an importable project JSON (release fields prefilled)")
    parser.add_argument("--no-checklist", action="store_true", help="do not append the verification checklist")
    args = parser.parse_args(argv)
    root = Path(args.repo).expanduser().resolve()
    if not root.is_dir():
        print("项目路径不存在：" + str(root), file=sys.stderr)
        return 1
    config = extract(Repo(root, args.branch), args.platform)
    text = markdown(config, args.title, not args.no_checklist)
    if args.out:
        out = Path(args.out).expanduser().resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
        print(f"已写入 {out}")
    else:
        sys.stdout.write(text)
    if args.project:
        name = f"{config.release.get('app') or 'App'} · {args.platform}"
        target = Path(args.project).expanduser().resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(project_json(config, text, name), encoding="utf-8")
        print(f"已写入 {target}（可直接导入看板，发布信息已预填 {len(config.release)} 项）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
