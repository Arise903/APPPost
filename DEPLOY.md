# 在线版部署：GitHub + Render + PostgreSQL

在线版入口是 `online.app:create_app()`。GitHub 保存源码、执行回归检查；Render 运行 Docker 服务；PostgreSQL 保存账号、项目、成员、检查记录和版本快照。GitHub Pages 不能直接运行本后端。

## 1. 本地预览

```sh
python3 -m venv .venv-online
.venv-online/bin/pip install -r requirements-online.txt
.venv-online/bin/python run_online.py
```

第一次启动会要求设置管理员邮箱和至少 12 位密码。预览地址为 `http://127.0.0.1:8787`。预览使用 SQLite，只监听本机，不启用调试器。

## 2. 上传 GitHub

推荐私有仓库。只提交源码和初始模板，不提交原始检查记录、浏览器草稿、数据库或真实环境变量。`.gitignore` 与 Docker 白名单已排除这些文件。可用 `scripts/package_online.py` 生成仅含部署源码的 ZIP。

仓库默认分支使用 `main`；若使用其他分支，请同步修改 `.github/workflows/online-ci.yml`。提交后 GitHub Actions 自动执行：

- 本地文件版回归与在线版 SQLite 测试。
- 使用独立 PostgreSQL 17 服务执行相同在线测试。
- 原有本地 HTTP 集成测试。
- 两份 JavaScript 语法检查。
- 生产 Docker 镜像构建。

建议为主分支启用保护规则，要求 `Online checks / test` 通过才能合并。

## 3. Render 上线

1. 登录 Render，并授权读取目标 GitHub 仓库。
2. 新建 Blueprint，选择此仓库和根目录 `render.yaml`。
3. 核对服务与数据库套餐。文件指定付费常驻服务及持久 PostgreSQL；应用 Blueprint 会产生云资源费用，按 Render 控制台当前报价确认。
4. 填写 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`。这是初始账号，只在邮箱尚未存在时创建；以后修改环境变量不会重置已有密码。
5. 部署完成后访问服务给出的 HTTPS 地址，登录并创建项目。健康检查为 `/healthz`。
6. 首次登录后在“账号设置”修改密码，可从 Render 环境变量中移除初始 `ADMIN_PASSWORD`。

`DATABASE_URL` 由 Blueprint 自动绑定。Render 会设置 `RENDER_EXTERNAL_URL`，用于同源校验。绑定自定义域名时设置 `PUBLIC_BASE_URL=https://你的域名`，并统一从这个地址访问。

自动部署设为 `checksPass`：主分支 CI 通过后更新服务。生产必须使用 PostgreSQL，避免将预览 SQLite 误部署到临时文件系统。数据库仅允许内部连接；变更该限制前应核对实际需要。

参考：[Render Blueprint 配置](https://render.com/docs/blueprint-spec)、[Flask 安全配置](https://flask.palletsprojects.com/en/stable/web-security/)。

## 4. 迁移现有记录

在工作台点“新建项目”，选择已有 Markdown。文件只上传到登录后的私有项目，不会加入 GitHub 源码。

Markdown 导入保留文本、勾选和项目特征；要同时迁移本地权限面板状态及发布备注，可先运行：

```sh
.venv-online/bin/python scripts/export_local_project.py --md 上架前App配置清单.md --out /tmp/我的完整项目.json
```

然后在新建项目时选该 JSON。工作台的“导出完整记录”也生成相同格式，支持跨设备或部署实例迁移。证据仅记录路径/链接，未上传本机证据文件。

## 5. 协作与恢复

- 项目默认仅创建者可见。
- 所有者可在项目卡片中管理成员，生成一次性、48 小时有效的邀请链接。系统不会代发邮件，由你自行发送链接。
- 受邀新账号设置姓名和密码即可加入；已有账号须先登录受邀邮箱。
- 编辑者可修改检查、权限及发布记录；查看者仅可阅读和导出。所有写入都在服务端检查权限。
- 项目保存校验版本；冲突返回 409，旧状态不会强制覆盖新状态。
- 云端恢复会一起恢复清单、权限面板、备注和发布记录。恢复前会创建当前状态快照；每项目保留最近 50 份。
- 发布归档是项目记录的一部分，可在导出的摘要或完整 JSON 中查看。

## 6. 备份与运维

项目快照用于应用内恢复，不能代替数据库备份。上线后在 Render 核对所选数据库计划的备份和恢复能力；定期导出完整项目，重要数据另存。

密码遗忘时，从可信的 Render Shell 执行：

```sh
flask --app 'online.app:create_app()' reset-password you@example.com
```

密码通过交互输入，重置会撤销该用户全部登录会话。请勿把密码放在命令参数、日志或 GitHub Secrets 以外的源码中。

数据库结构目前为首版，通过幂等初始化创建；PostgreSQL 使用事务级锁避免多进程初始化竞争。后续升级表结构应引入显式版本迁移，勿直接删除生产数据表。

会话有效期 7 天；服务器仅保存会话 token 的哈希；生产 Cookie 启用 Secure、HttpOnly 和 SameSite。浏览器草稿按用户和项目分隔。邀请仅用于建立项目成员身份，不提供公开注册或邮件验证功能。
