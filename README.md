# Release Desk · App 上架工作台

源码仓库：[Arise903/APPPost](https://github.com/Arise903/APPPost)（公开源码，不包含个人检查记录或凭证）。

直接使用：[GitHub Pages 个人工作台](https://arise903.github.io/APPPost/)。

新增 **GitHub Pages 个人版**：无需服务器，打开网页即可检查、备注、配置权限、归档和导入导出。数据默认保存在当前浏览器，也可手动同步到专用私有 `Arise903/APPdata` 仓库；发布设置及使用说明见 [PAGES.md](PAGES.md)。

新增在线版：支持账号登录、多个私有项目、云端记录、成员权限与完整快照恢复。GitHub CI 和 Render + PostgreSQL 部署已配置，详见 [在线部署说明](DEPLOY.md)。

本地预览：安装 `requirements-online.txt` 后运行 `python run_online.py`。原有本地文件版继续保留，以下为其说明。

从 GitHub 首次获取后，先复制初始模板：`cp online/default_checklist.md 上架前App配置清单.md`。

双击 `启动看板.command`，或运行 `python3 checklist_tool.py serve`。要求 Python 3.8+，无第三方 Python 依赖。已有服务需要停止后重新启动，才能加载后端更新。

## 日常操作

1. 阅读使用说明并确认，然后按顺序处理清单。
2. 勾选与跳过先保存在浏览器草稿中，点击“保存”才写回 Markdown。
3. 每项的“备注 / 证据”可填写跳过原因、检查说明和证据路径或链接；记录立即保存。
4. “发布信息”记录 App 名称、平台、版本、构建、检查日期和负责人。
5. 保存进度后点击“归档本次发布”，保留当前发布快照。修改发布信息后可继续下一批检查。
6. “导出发布摘要”下载当前结果、备注、证据和历史记录。未保存的进度会明确标注。
7. “恢复备份”按序号恢复 Markdown。恢复前先备份当前文件。权限面板数据与发布记录保留当前值，不随 Markdown 恢复。

若提示文件版本冲突，请先导出摘要或副本保留草稿，再刷新页面，与最新记录核对后重做冲突项。系统不会强制覆盖别人已经保存的进度。

## 数据与备份

- Markdown：检查项、状态、项目特征、生成的权限附录。
- `.<清单名>.permstate.json`：权限面板选项和用途描述。
- `.<清单名>.review.json`：发布信息、备注证据及归档；`.previous` 保留上一版记录。
- `.checklist_generation.json`：清空操作的世代号。
- `.md.bak-*`：最近五份 Markdown 备份，文件名包含微秒。

移动项目时应一起复制这些隐藏文件。证据路径仅保存文本，不会复制证据文件。浏览器草稿与浏览器、访问地址相关；更换端口前先保存或导出。

各文件使用临时文件和原子替换降低写入中断风险；多个文件不构成跨文件事务。服务内锁保护并发操作；外部编辑器若恰好在版本检查后、替换前写入，仍存在很小的竞态窗口。适用于本机个人流程，不是多人协作数据库。

权限附录以 `PERMISSION_APPENDIX` 和 `PERMISSION_APPENDIX_END` 标记范围；旧格式首次保存时会保留后续用户二级章节。不要手动删除新结束标记。

## 维护

- `board_template.html`：页面结构。
- `board.css` / `board.js`：样式与交互；构建时内联，所以生成的 HTML 可独立离线打开。
- `checklist_tool.py`：解析、配置生成、API 与命令行。在线页面与离线构建共用数据组装逻辑。
- `storage_utils.py`：原子写入、版本哈希与发布记录存储。
- `permission_profiles.json`：权限资料及维护元信息。

权限资料保留现有内容并标记为待逐项核验。`maintenance` 支持来源、适用版本、核验日期；未核验项目不得填写虚假的完成日期。官方参考入口见 JSON 中的 references。当前工具生成配置片段，不能代替对目标 App 实际数据流及 SDK 行为的检查。

支持的 Markdown 为受控子集：标题、任务、普通列表、引用、表格和反引号代码块。标准条目和章节已采用固定 ID 标记；修改文案时保留标记，进度与备注继续对应。旧项目会在升级时补上标记并保留迁移前快照。

## 验证

```sh
python3 -m unittest -v test_checklist
python3 test_http_integration.py
python3 checklist_tool.py build
```

HTTP 集成测试只绑定本机随机端口并使用临时目录，需要环境允许本机监听。浏览器验证还应覆盖勾选保存、版本冲突、备注保存、归档、摘要下载和刷新恢复。

Pages 个人工作流的最新入口、发布就绪检查、创建配置和存储评估见 [PAGES.md](PAGES.md#整体体验与发布就绪检查)。共用看板模块位于 `board/`，由 `checklist_tool.load_board_js()` 统一组装；修改任一模块后重新运行 `python3 scripts/build_pages.py`。

个人版现已加入 IndexedDB 自动迁移与回退、可随备份保存的证据附件、配置自动预检、通用模板库、发布批次对比、例外复查和发布总览。入口与文件大小限制见 [完整发布工作流](PAGES.md#完整发布工作流)。
