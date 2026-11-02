import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))
import extract_flutter_config as extractor  # noqa: E402

PUBSPEC = """name: demo
description: "demo"
version: 2.0.1+7

dependencies:
  flutter:
    sdk: flutter
  billing_core:
    git:
      url: git@github.com:einsts/billing_core.git
      ref: 0.2.1
"""
GRADLE = """android {
    namespace = "com.example.demo"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.example.demo"
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        }
    }
}
"""
MANIFEST = """<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.RECORD_AUDIO"/>
    <uses-permission android:name="android.permission.CAMERA"/>
    <application android:label="Demo" android:usesCleartextTraffic="false"></application>
</manifest>
"""
PBX = "\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.demo;\n\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 15.0;\n\t\t\t\tMARKETING_VERSION = 2.0.1;\n\t\t\t\tCURRENT_PROJECT_VERSION = 7;\n"
PLIST = """<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Demo</string>
<key>NSCameraUsageDescription</key><string>camera</string>
<key>UIBackgroundModes</key><array><string>audio</string></array>
<key>ITSAppUsesNonExemptEncryption</key><false/>
</dict></plist>
"""
CONFIG = """class BaseConfig {
  static const forceVip = false;
  static const Duration splashMaxDelay = Duration(seconds: 30);
  static const Duration timeout = Duration(seconds: 15);
  static final int projectId = Platform.isIOS ? 11 : 22;
  static const String terms_android_url = "https://example.com/terms/";
  static const String policy_android_url = "https://example.com/android-policy";
  static const String terms_ios_url = "https://example.com/ios-terms/";
  static const String policy_ios_url = "https://example.com/ios-policy";
  // static const String productIdOnce = "old_once";
  static const String productIdWeek = "demo_w_01";
}
"""
ADJUST = """class AdjustManager {
  Future<void> init() async {
    if (!Platform.isIOS) return;
    AdjustConfig config = AdjustConfig('tokenvalue', kDebugMode ? AdjustEnvironment.sandbox : AdjustEnvironment.production);
  }
}
"""
ANALYSIS = """class AnalysisApi {
  static const String _baseUrl = "https://stats.example.com";
}
"""
FEEDBACK = "https://open.fire-api.com/feedback/add\n"


def build_repo(root: Path) -> None:
    def write(path: str, text: str) -> None:
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    write("pubspec.yaml", PUBSPEC)
    write("android/app/build.gradle.kts", GRADLE)
    write("android/app/src/main/AndroidManifest.xml", MANIFEST)
    write("ios/Runner.xcodeproj/project.pbxproj", PBX)
    write("ios/Runner/Info.plist", PLIST)
    write("ios/Runner/GoogleService-Info.plist", "<plist><dict><key>PROJECT_ID</key><string>demo-project</string>"
          "<key>BUNDLE_ID</key><string>com.example.other</string></dict></plist>")
    write("lib/base/config/configuration.dart", CONFIG)
    write("lib/base/analysis/adjust_manager.dart", ADJUST)
    write("lib/base/analysis/analysis_api.dart", ANALYSIS)
    write("lib/base/api/feedback.dart", FEEDBACK)
    write("lib/l10n/app_en.arb", "{}")
    write("lib/l10n/app_zh.arb", "{}")


class FlutterConfigExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        build_repo(self.root)
        self.addCleanup(self.temporary.cleanup)

    def rows(self, platform):
        config = extractor.extract(extractor.Repo(self.root, None), platform)
        return {label: value for label, value in config.rows}, config

    def test_android_branch_values(self):
        rows, config = self.rows("Android")
        self.assertEqual(rows["版本 / 构建"], "2.0.1 / 7")
        self.assertEqual(rows["Android 应用标识"], "com.example.demo")
        self.assertEqual(rows["最低 Android SDK"], "24")
        self.assertEqual(rows["compileSdk"], "35")
        self.assertEqual(rows["AnalysisApi 地址"], "https://stats.example.com")
        self.assertEqual(rows["AnalysisApi projectId"], "22")
        self.assertEqual(rows["隐私政策地址"], "https://example.com/android-policy")
        self.assertEqual(rows["用户协议地址"], "https://example.com/terms/")
        self.assertIn("RECORD_AUDIO", rows["代码显式权限"])
        self.assertEqual(rows["HTTP 明文开关"].split("；")[0], "usesCleartextTraffic=false")
        self.assertEqual(rows["订阅商品 ID"], "demo_w_01（configuration.dart）")
        self.assertEqual(rows["测试强制会员"], "forceVip = false")
        self.assertIn("billing_core @ 0.2.1", rows["Git 依赖"])
        self.assertEqual(config.release["version"], "2.0.1")
        self.assertEqual(config.release["analysisApiProjectId"], "22")
        self.assertIn("com.example.other", " ".join(config.notes))

    def test_ios_branch_values(self):
        rows, config = self.rows("iOS")
        self.assertEqual(rows["AnalysisApi projectId"], "11")
        self.assertEqual(rows["隐私政策地址"], "https://example.com/ios-policy")
        self.assertEqual(rows["iOS 应用标识"], "com.example.demo")
        self.assertEqual(rows["iOS 最低系统版本"], "15.0")
        self.assertIn("NSCameraUsageDescription", rows["iOS 权限用途说明"])
        self.assertIn("adjust_manager.dart", rows["Adjust Token 配置位置"])
        self.assertEqual(rows["Adjust appToken"], "tokenvalue")

    def test_markdown_and_branch_reading(self):
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.root), "-c", "user.email=t@example.com", "-c", "user.name=t",
                        "commit", "-qm", "init"], check=True)
        config = extractor.extract(extractor.Repo(self.root, "HEAD"), "Android")
        text = extractor.markdown(config, "从分支提取的配置信息")
        self.assertIn("| 配置项 | 代码中的值 / 分析结论 |", text)
        self.assertIn("| AnalysisApi projectId | 22 |", text)
        self.assertIn("### 建议填入发布信息", text)
        self.assertIn("源提交", text)


if __name__ == "__main__":
    unittest.main()
