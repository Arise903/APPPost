# Release Desk · App 上架工作台

把 App 上架前的检查项、权限配置、证据和发布归档放在同一份记录里维护。

源码仓库：[Arise903/APPPost](https://github.com/Arise903/APPPost)（公开源码，不包含个人检查记录或凭证）。
直接使用：[GitHub Pages 个人工作台](https://arise903.github.io/APPPost/)。

## 三种使用方式

| 形态 | 入口 | 数据位置 | 适用场景 |
| --- | --- | --- | --- |
| GitHub Pages 个人版 | 打开 Pages 网址，无需服务器 | 当前浏览器；可手动同步到自选私有 GitHub 仓库 | 单人使用，换设备靠导出或仓库同步 |
| 在线版 | 部署后的账号登录页 | PostgreSQL 云端 | 多个私有项目、成员权限、完整快照恢复 |
| 本地文件版 | 双击 `启动看板.command` | 本机 Markdown 与同名隐藏文件 | 记录跟随项目目录，可离线打开 HTML |

三种形态共用同一套看板与保存编排；差异见 [PAGES.md](PAGES.md) 与 [DEPLOY.md](DEPLOY.md)。

## 快速开始

### GitHub Pages 个人版

打开 [个人工作台](https://arise903.github.io/APPPost/) 即可检查、备注、配置权限、归档和导入导出。数据默认保存在当前浏览器，也可连接自选的私有 GitHub 仓库手动上传与拉取。发布设置、文件大小限制与存储说明见 [PAGES.md](PAGES.md)。

### 在线版

安装 `requirements-online.txt` 后运行 `python run_online.py` 本地预览；部署到 Render + PostgreSQL 的步骤见 [在线部署说明](DEPLOY.md)。支持账号登录、多个私有项目、云端记录、成员权限与完整快照恢复。

### 本地文件版

```sh
cp online/default_checklist.md 上架前App配置清单.md   # 首次获取后初始化清单
python3 checklist_tool.py serve                       # 或双击 启动看板.command
```

要求 Python 3.8+，无第三方 Python 依赖。已有服务需要停止后重新启动，才能加载后端更新。`build` 子命令可生成可独立离线打开的静态看板 HTML。

## 日常操作

1. 所有项目（包括通用模板和导入项目）都需先阅读使用说明并确认，然后才能开始检查。取消确认会重新锁定，已有进度保留。
2. 勾选与跳过先保存在浏览器草稿中，点击“保存”才写回 Markdown。
3. 每项的“备注 / 证据”可填写跳过原因、检查说明和证据路径或链接；记录立即保存。
4. “发布信息”记录 App 名称、平台、版本、构建、检查日期和负责人。
5. 保存进度后点击“归档本次发布”，保留当前发布快照。修改发布信息后可继续下一批检查。
6. “导出发布摘要”下载当前结果、备注、证据和历史记录。未保存的进度会明确标注。
7. “恢复备份”按序号恢复 Markdown。恢复前先备份当前文件。权限面板数据与发布记录保留当前值，不随 Markdown 恢复。
8. 所有适用检查项完成、进度达到 100% 并保存后，可通过「项目配置 → 导出 AI 排查文档（.md）」生成供 AI 对照仓库分析遗漏的完整配置与检查记录；详见 [导出 AI 排查文档](PAGES.md#导出-ai-排查文档)。

若提示文件版本冲突，请先导出摘要或副本保留草稿，再刷新页面，与最新记录核对后重做冲突项。系统不会强制覆盖别人已经保存的进度。

## 数据与备份（本地文件版）

- Markdown：检查项、状态、项目特征、生成的权限附录。
- `.<清单名>.permstate.json`：权限面板选项和用途描述。
- `.<清单名>.review.json`：发布信息、备注证据及归档；`.previous` 保留上一版记录。
- `.checklist_generation.json`：清空操作的世代号。
- `.md.bak-*`：最近五份 Markdown 备份，文件名包含微秒。

移动项目时应一起复制这些隐藏文件。证据路径仅保存文本，不会复制证据文件。浏览器草稿与浏览器、访问地址相关；更换端口前先保存或导出。

各文件使用临时文件和原子替换降低写入中断风险；多个文件不构成跨文件事务。服务内锁保护并发操作；外部编辑器若恰好在版本检查后、替换前写入，仍存在很小的竞态窗口。适用于本机个人流程，不是多人协作数据库。

权限附录以 `PERMISSION_APPENDIX` 和 `PERMISSION_APPENDIX_END` 标记范围；旧格式首次保存时会保留后续用户二级章节。不要手动删除新结束标记。

## 代码结构

| 路径 | 职责 |
| --- | --- |
| `board_template.html` | 页面结构 |
| `board.css` / `board.js` | 样式与交互；构建时内联，生成的 HTML 可独立离线打开 |
| `board/` | 共用看板模块（功能开关、详情、权限、发布、订阅、恢复等），由 `checklist_tool.load_board_js()` 统一组装 |
| `checklist_tool.py` | Markdown 解析、配置生成、本地 API 与命令行；在线页面与离线构建共用数据组装逻辑 |
| `storage_utils.py` | 原子写入、版本哈希与发布记录存储 |
| `release_policy.py` | 版本化的发布就绪策略与发布记录校验 |
| `permission_profiles.json` | 权限资料及维护元信息 |
| `permission_rules.json` / `permission_visibility.*` | 按权限与平台决定检查项是否适用 |
| `pages/` | Pages 个人版源码（浏览器存储、工作台、GitHub 同步） |
| `docs/` | Pages 构建产物，由 `scripts/build_pages.py` 生成并校验 |
| `online/` | 在线版 Flask 应用、数据库层与静态资源 |

修改 `board/` 任一模块后重新运行 `python3 scripts/build_pages.py`，并提交更新后的 `docs/`。

支持的 Markdown 为受控子集：标题、任务、普通列表、引用、表格和反引号代码块。标准条目和章节已采用固定 ID 标记；修改文案时保留标记，进度与备注继续对应。旧项目会在升级时补上标记并保留迁移前快照。

权限资料保留现有内容并标记为待逐项核验。`maintenance` 支持来源、适用版本、核验日期；未核验项目不得填写虚假的完成日期。官方参考入口见 JSON 中的 references。当前工具生成配置片段，不能代替对目标 App 实际数据流及 SDK 行为的检查。

## 验证

```sh
pip install -r requirements-online.txt
python3 -m unittest -v test_checklist test_online test_migrations test_operations   # 解析、在线服务、迁移、双后端一致性
python3 test_http_integration.py                                                    # 本地服务全部 /api 端点
ruff check .                                                                        # Python 静态检查
node --test test_pages.cjs                                                          # Pages 存储、发布规则、两端文案一致性
python3 checklist_tool.py build                                                     # 离线静态看板
python3 scripts/build_pages.py                                                      # Pages 个人版构建
python3 -m unittest -v test_extract_config                                          # Flutter 配置提取
```

从本地 Flutter 仓库提取发布配置（包名、版本、SDK、权限、AnalysisApi、Adjust 与订阅等，密钥只记录变量与位置）：

```sh
python3 scripts/extract_flutter_config.py <项目路径> --branch android --platform Android --out exported/app.md
python3 scripts/extract_flutter_config.py <项目路径> --branch feature-iOS --platform iOS --out exported/app-ios.md
```

生成的 Markdown 可直接导入看板：新建项目时选择该 `.md`，或把「从分支提取的配置信息」表格并入现有清单，项目配置信息会回退显示这些已提取的值。加 `--project out.json` 会额外生成可直接导入的项目 JSON（发布信息、功能开关、权限勾选与中英文权限说明都已按源码预填）；`--permissions` 可指定权限清单，默认用本仓库的 `permission_profiles.json`。

`test_operations.py` 让本地文件版与在线版执行同一串操作（确认、保存、备注、特征、订阅、权限写回、清空、取消确认），逐项比对检查项状态、项目特征与发布信息；`test_pages.cjs` 另有一致性用例，用同一份输入比对 JS 与 Python 的权限配置生成和可见性规则。

HTTP 集成测试只绑定本机随机端口并使用临时目录，需要环境允许本机监听。浏览器验证还应覆盖勾选保存、版本冲突、备注保存、归档、摘要下载和刷新恢复；`scripts/test_*.cjs` 提供基于 Playwright 的渲染、流程与视觉回归脚本，`npm run test:browser` / `npm run test:visual` 分别执行，`scripts/compare_visual.py` 比对 `tests/visual` 基线。

CI 配置见 `.github/workflows/online-ci.yml`：先执行 `ruff check`，在 PostgreSQL 服务下跑 Python 用例，校验 `docs/` 与源码构建一致，再执行浏览器与视觉回归。

## 相关文档

- [PAGES.md](PAGES.md)：Pages 个人版的发布、使用与数据边界，包含[完整发布工作流](PAGES.md#完整发布工作流)与[发布流程与整体体验](PAGES.md#发布流程与整体体验)。
- [DEPLOY.md](DEPLOY.md)：在线版本地预览、Render 上线、记录迁移与运维。
