# 上架前 App 配置 Checklist

<!-- FEATURES hasAccountSystem=1 targetMinors=1 hasFeedbackSystem=0 -->

## 零、怎么用 <!-- section:s_f6dc9f35 -->

<!-- GUIDE -->

> 本工作台把检查进度、权限配置、备注证据和发布批次保存在你的私有项目中。

### 开始检查

- 阅读本页并确认后，按顺序完成清单；不适用的项目可以跳过，并在备注中说明原因。
- 勾选先保存在当前浏览器草稿中，点击「保存」才同步到云端。
- 备注与证据、权限配置和发布信息分别保存；网络失败时请查看错误提示。
- 项目设置可隐藏账号系统和未成年人相关的不适用条目。

### 发布与协作

- 发布前填写版本、构建号和负责人，保存进度后归档本次发布。
- 返回项目工作台可导出完整 JSON，或由所有者邀请编辑者和查看者。
- 多个成员同时保存会校验版本，冲突时先导出草稿，再刷新核对。
- 恢复备份会一起恢复清单、权限配置、备注和发布信息；恢复前保留当前快照。
- 证据字段只保存路径或链接，不会自动上传你的本机文件。
- 每次发布后清空检查进度可开始新一轮；此前的归档记录会继续保留。

## 一、配置项清单 <!-- section:s_ca46c0f5 -->

### 1. Adjust（广告归因）— `AdjustManager`

- [ ] `appToken` 已替换为**正式环境真实 Token**，且 iOS / Android 使用各自平台的 Token（不是同一个值） <!-- task:t_8867619d -->
- [ ] `config.isAdServicesEnabled` 的取值已**按业务定位最终确认**（当前为 `false`） <!-- task:t_d1a80cfd -->
- [ ] 已确认 `false` 时的行为符合预期： <!-- task:t_4cc4f45c -->
  - Adjust SDK **完全不初始化**，ATT **不发起请求**（避免无意义的隐私弹窗 + 空跑链路）
  - 调试期通过编译期常量 / `--dart-define` 区分，不要把开关硬编码在业务代码里
- [ ] 已配置 Adjust 深度链接 / 场景值（deeplink、归因回调） <!-- task:t_3205c930 -->

> ⚠️ `isAdServicesEnabled = false` 却仍保留 ATT 流程 = 白白弹权限、拖慢启动、给审核留下"声明了却没用"的疑点。开关必须真的短路整条链路。
>
> 💡 ATT 的声明统一在「权限与隐私配置」面板的「跨应用追踪」里勾选，清单里不单独配。

### 2. 自有统计 — `AnalysisApi`

- [ ] `_baseUrl` 已指向**生产环境**域名 <!-- task:t_69393d68 -->
- [ ] `projectId` 已配置，且与环境（prod / staging）对应正确 <!-- task:t_2375cc14 -->
- [ ] Release 构建不会指向测试环境（建议用 `--dart-define` 注入，检查打包脚本） <!-- task:t_092c4082 -->
- [ ] UUID 读取 / 生成逻辑已验证：首次启动生成、卸载重装是否重置（策略需明确写死） <!-- task:t_cf56707f -->
- [ ] 用户上报、token 上报、行为队列（离线缓存 + 上报）三条路径均可用 <!-- task:t_2b5552a2 -->
- [ ] token 无效 / 过期时的降级逻辑已验证（不影响主流程） <!-- task:t_6c4ae52f -->

### 3. 用户反馈 — `feedbackApiKey`

- [ ] `feedbackApiKey` 已替换为正式 Key（未使用测试 Key / 空值） <!-- task:t_3b8c1729 -->
- [ ] 反馈入口在设置页可达，路径不深（≤ 2 次点击） <!-- task:t_2ca0dee8 -->
- [ ] 反馈提交链路**真机自测通过**（能收到反馈、能失败重试） <!-- task:t_7f2f1dd7 -->
- [ ] 反馈渠道（邮箱 / 表单）真实可用，有人处理 <!-- task:t_1b7e06e5 -->

### 4. 订阅商品与环境

#### 4.1 环境切换（最容易出事的环节）

- [ ] **沙盒 / 本地测试环境已完全关闭**，Release 包不会连到 StoreKit 测试环境 <!-- task:t_278d76f1 -->
  - Xcode → Target → Build Phases → 确认没有 `Copy StoreKit Configuration File` 步骤留在 Release
  - 或直接扫代码：`grep -ri "storetest\|localconfiguration\|SKTestSession" lib/ ios/ android/`
- [ ] Android 侧 `BillingClient` 的测试开关（`setTestAPI` / `isBillingTest` 之类）在 Release 里为 false <!-- task:t_9e1e4c91 -->
- [ ] 订阅数据源指向**生产商品**，不是沙盒商品 <!-- task:t_e85df36d -->
  - 运行时日志里能拉到真实商品 ID，而非 `com.apple.test.*` 这类沙盒商品
- [ ] 自有服务器的订阅状态接口也指向生产库，测试环境的订单没有写进生产 <!-- task:t_bbd686b3 -->
- [ ] 环境开关由编译期常量 / `--dart-define` 控制，不在业务代码里硬编码 `kDebugMode` <!-- task:t_4d9284e8 -->
- [ ] **已用 Release 包真机真实购买过一次**（TestFlight 能买 ≠ App Store 能买） <!-- task:t_d207883b -->

> ⚠️ **最高频事故**：Release 包里还留着 StoreKit 测试配置。表现是「测试阶段一切正常，上架后买不了」——
> 线上用户拿到沙盒商品 ID，或审核员在沙盒环境实测失败。提审前必须在 Release 包上完成一次真实购买。

#### 4.2 商品、周期与价格

- [ ] 订阅商品 ID 已在 App Store Connect / Google Play Console 创建并**通过审核**（未过审的商品线上不可售） <!-- task:t_64e0e769 -->
- [ ] 商品 ID 与代码里的映射一致（iOS 与 Android 各自的 product id） <!-- task:t_1e030895 -->
- [ ] 订阅周期已配置并与产品设计一致（周 / 月 / 年 / 自定义周期） <!-- task:t_07b2558b -->
- [ ] 每个周期都有独立价格点（Price Point） <!-- task:t_5cc6822e -->
- [ ] 价格点已设置**销售范围（Base Territory）**—— 不设销售范围 = 全球商店里买不到 <!-- task:t_b8e9dda7 -->
- [ ] 各档位的权益差异与代码逻辑一一对应（升级 / 降级策略已实现） <!-- task:t_a89e5957 -->
- [ ] 显示价格按地区本地化后符合预期（不是看自己填的数值） <!-- task:t_4b247aa0 -->
- [ ] **免费试用**已配置：试用时长（3 天 / 7 天）、试用结束后的价格正确回落到订阅价 <!-- task:t_685b49b8 -->
- [ ] 试用是否可重复领取、是否与优惠叠加，行为与预期一致 <!-- task:t_d7c8cfe1 -->
- [ ] **优惠 / 促销价**已配置： <!-- task:t_f6aa2929 -->
  - [ ] 优惠价金额 <!-- task:t_2a16cdca -->
  - [ ] 优惠生效时间（起止日期，注意时区与时区切换） <!-- task:t_df902052 -->
  - [ ] 参与优惠的商品（哪些订阅档位） <!-- task:t_d405c325 -->
  - [ ] 每个用户可享受次数（单次优惠 / 续订优惠可重复） <!-- task:t_b7322922 -->
  - [ ] 优惠与免费试用的叠加规则 <!-- task:t_70632a61 -->
- [ ] 家庭共享（Family Sharing）按产品策略开启或关闭 <!-- task:t_8effa955 -->
- [ ] 订阅分组（Subscription Group）正确，同组内商品可互相升级 <!-- task:t_a94dce5f -->
- [ ] 涨价通知流程已验证（App Store 要求提前通知，代码里也要处理续订时的价格变更） <!-- task:t_b660c898 -->

#### 4.3 购买流程验证

- [ ] 购买成功、取消、恢复购买、续订失败全部走通 <!-- task:t_189e7fc0 -->
- [ ] 沙盒账号（Sandbox Tester）已覆盖上述路径 <!-- task:t_9c18ce64 -->
- [ ] 恢复购买能正确还原订阅状态（换机 / 重装后） <!-- task:t_59a647f8 -->
- [ ] 订阅状态**不阻塞**统计初始化（见第二节） <!-- task:t_ffcee7b0 -->
- [ ] 订阅状态变化能正确上报自有统计（用户 / token / 行为队列） <!-- task:t_65436aa0 -->

---

### 5. 发布账号与证书

#### 5.1 Apple 开发者账号

- [ ] 当前用的是**正式上架账号**，不是个人测试账号或临时账号 <!-- task:t_d669db33 -->
- [ ] 账号主体（个人 / 公司）与 App Store 显示的名称一致 <!-- task:t_755eb036 -->
- [ ] **中途换过账号的话**，bundle ID 必须用新账号重新注册 <!-- task:t_fa2c1ab7 -->
  - 换账号后沿用旧 bundle ID = 无法提交，这是硬性限制
- [ ] 旧账号下的 App 已按需处理（转移或删除），不影响新账号提交 <!-- task:t_c1ff806f -->
- [ ] 协议（Apple Developer Program License）已签署且生效 <!-- task:t_e2cf0e51 -->
- [ ] 税务信息、银行信息已提交（影响 Apple 抽成结算） <!-- task:t_245416b5 -->
- [ ] 账号下所有用到的 bundle ID 都已注册 <!-- task:t_90714170 -->
- [ ] App Store Connect 里的 App 已创建，元信息（名称、描述、关键词、分类）已填 <!-- task:t_93d65e8e -->

#### 5.2 证书与描述文件

- [ ] **发布证书（Distribution Certificate）**已创建，有效期未过期 <!-- task:t_73116bf6 -->
- [ ] **描述文件（Provisioning Profile）类型为 App Store / Distribution**，不是 Development <!-- task:t_5bb3a143 -->
  - 类型选错 = 能装到设备但传不上架
- [ ] 描述文件包含所有实际用到的能力： <!-- task:t_7180c3b6 -->
  - [ ] Push Notifications（用了推送就必须有） <!-- task:t_36e3f51a -->
  - [ ] Associated Domains（用了 Universal Links / App Links 必须有） <!-- task:t_fc569848 -->
  - [ ] App Groups（用了共享数据必须有） <!-- task:t_2215d265 -->
  - [ ] Merchant ID（内购必须） <!-- task:t_7990e422 -->
- [ ] App ID 的 Capabilities 与代码实际用到的功能**一致**，多余的已删除（审核会质疑） <!-- task:t_8c46c981 -->
- [ ] APNs 推送的 p8 密钥或证书已配置（代码里调了推送就必须有，否则推送静默失败） <!-- task:t_c7c9aea7 -->
- [ ] Xcode 的 Team 选对了，且与 App Store Connect 记录的证书是同一套 <!-- task:t_af5f214a -->
  - 上传构建用的证书与后台记录的不一致 → 报签名不匹配
- [ ] 上传构建用的证书和后台 App Store Connect 记录的证书是同一个（否则上传报签名不匹配） <!-- task:t_c67b7080 -->

#### 5.3 Android 侧账号与签名

- [ ] Google Play 开发者账号已通过身份验证（一次性注册费用） <!-- task:t_ebf43bde -->
- [ ] 已启用 Play App Signing，上传密钥（upload key）**已备份** <!-- task:t_092b7ad4 -->
- [ ] release 签名密钥（jks）**已备份**，且与 Play 记录一致（丢了就无法再上传） <!-- task:t_0d1742fa -->
- [ ] 密钥库密码 / 别名 / 密码有妥善记录（团队协作需要） <!-- task:t_c8334401 -->
- [ ] 目标 API Level 符合 Google Play 最新要求 <!-- task:t_d73816ab -->
- [ ] 内测 / 封闭测试轨道的测试账号已准备（审核员会用到） <!-- task:t_93edf33e -->

---

## 二、初始化流程核对 <!-- section:s_2c5ffd84 -->

### 目标时序

```text
App 启动
  ↓
初始化 Flutter
  ↓
初始化 AnalysisApi：读取/生成 UUID，加载用户、token、行为队列状态
  ↓
完成订阅基础配置 → runApp()
  ↓
首帧渲染完成 → 独立启动统计流程
  ↓
并行执行两条链路：
  ├─ Adjust 链路（阻塞等待 ATT）
  │    等待 App 前台 + 界面就绪
  │      ↓
  │    检查并按需请求 ATT
  │      ↓
  │    等待明确结果：允许 / 拒绝 / 受限
  │      ↓
  │    关联 UUID → 初始化 Adjust（只执行一次）
  │
  └─ 自有统计链路（不等待 ATT、不等待 Adjust）
       尝试获取 AttributionToken（最多等待 3 秒）
         ↓
       上报用户
         ├─ 有有效 token：随用户一起提交
         └─ 无 token：先上报用户，后续单独补传
```

### 逐条验收

- [ ] `runApp()` 在订阅基础配置完成后调用，**首帧渲染完成**才启动统计流程 <!-- task:t_98829c38 -->
- [ ] Adjust 链路**必须等 ATT 明确结束**才能初始化 Adjust <!-- task:t_aad69bfe -->
- [ ] ATT 未决定 / 请求失败 → 继续等待并重试，**不阻塞**启动，也不擅自初始化 Adjust <!-- task:t_faf300d9 -->
- [ ] Adjust 初始化有**幂等保护**，无论重试多少次只执行一次 <!-- task:t_47f7c871 -->
- [ ] ATT 结果为「允许 / 拒绝 / 受限」三种之一时都能正常推进，不卡死在某一种分支 <!-- task:t_71952b07 -->
- [ ] 自有统计链路**不等 ATT、不等 Adjust 初始化**，与 Adjust 链路真正并行 <!-- task:t_da6459c0 -->
- [ ] AttributionToken 获取最多等 3 秒，超时后走「无 token」分支，不无限挂起 <!-- task:t_61bf77e2 -->
- [ ] 无 token 时：用户先上报，token 后续单独补传（不丢数据） <!-- task:t_89061d31 -->
- [ ] 上报失败后按前台 **5 → 15 → 60 秒**间隔有限重试 <!-- task:t_80f8d8c0 -->
- [ ] 进入后台时**暂停重试**，回到前台可继续（定时器生命周期正确） <!-- task:t_4ae23e58 -->
- [ ] 订阅初始化与商品加载**独立进行**，不阻塞统计链路 <!-- task:t_333df253 -->

---

## 三、提交前机械检查（10 分钟跑完） <!-- section:s_93d9eee3 -->

- [ ] 全仓搜索占位符残留：`appToken`、`projectId`、`feedbackApiKey`、`baseUrl`、`TODO`、`your_api_key`、`xxx` <!-- task:t_43293683 -->
- [ ] 搜索测试域名：`staging` / `test` / `dev` / `localhost` / `127.0.0.1` <!-- task:t_2849196d -->
- [ ] 搜索 Google / Apple 的示例 Key 残留（`AIza` 开头的 Google API Key） <!-- task:t_8d7fee8c -->
- [ ] Release 包体里不含调试开关（`assert`、`kDebugMode` 分支、dev 菜单） <!-- task:t_9ded9b72 -->
- [ ] 崩溃日志 / 埋点上报的是**生产**通道，不是 debug 通道 <!-- task:t_90824566 -->
- [ ] 扫订阅测试环境残留：`grep -riE "storetest|localconfiguration|SKTestSession|setTestAPI|BillingTest" lib/ ios/ android/` <!-- task:t_91914237 -->
  - 命中即确认该代码路径在 Release 不会执行（否则订阅项 4.1 必然翻车）

---

## 四、平台审核高频拒审点 <!-- section:s_c96d09c0 -->

> 本章只列**与权限、隐私无关**的拒审点。
> 权限与隐私相关的审核要点已全部归入「五、权限与隐私配置」。

**iOS**

- [ ] 订阅页需明确价格、周期、自动续订说明、隐私政策与用户协议链接 <!-- task:t_89f68fa5 -->
- [ ] 演示账号可登录（若 App 有登录墙） <!-- if:hasAccountSystem --> <!-- task:t_736d15b5 -->

**Android**

- [ ] 目标 API Level 符合 Google Play 最新要求 <!-- task:t_d773b98d -->

**双端**

- [ ] 未成年人保护 / 家长控制相关说明 <!-- if:targetMinors --> <!-- task:t_2dfc3ff4 -->
- [ ] 应用内无引导用户给五星好评的文案 <!-- task:t_f38b7ef1 -->

---

## 五、权限与隐私配置 <!-- section:s_b95b3242 -->

> **本章涵盖所有需要权限声明与隐私说明的内容**，原先散在配置项清单、审核要点里的
> 权限与隐私条目都已归并到这里。
>
> 实际配置片段由「权限配置」面板生成到文末附录，本章负责**核对一致性**：
> 面板勾了什么 → 政策怎么写 → 问卷怎么选 → 代码怎么调，四处必须对得上。

### 5.1 隐私政策内容与披露

- [ ] 隐私政策线上地址可访问（**必须 HTTPS**，非内网 / 本地地址） <!-- task:t_db4e201c -->
- [ ] 「关于我们」地址可访问 <!-- task:t_57280b68 -->
- [ ] App **内**有隐私政策入口（不能只在官网，审核员会在 App 内查找） <!-- task:t_ac3b7393 -->
- [ ] 隐私政策内容覆盖： <!-- task:t_d1fb6af9 -->
  - [ ] 收集的个人信息清单（设备标识符、用户 ID、订阅状态、崩溃日志等） <!-- task:t_1ea53330 -->
  - [ ] **第三方 SDK 清单**（必须与实际集成的 SDK 完全一致，含 Adjust） <!-- task:t_04b6e624 -->
  - [ ] 数据用途、存储地点、保留期限 <!-- task:t_01f7d10f -->
  - [ ] 用户数据删除 / 账号注销的**具体操作路径** <!-- if:hasAccountSystem --> <!-- task:t_1adcdcdc -->
  - [ ] 儿童隐私条款（COPPA / 儿童个人信息网络保护规定） <!-- if:targetMinors --> <!-- task:t_b50a5797 -->
  - [ ] 联系方式（邮箱 + 响应时效承诺） <!-- task:t_eccdfcb4 -->
- [ ] 隐私政策覆盖**每一项**实际采集的数据类型（对照附录的隐私问卷勾选结果） <!-- task:t_80590ad7 -->
- [ ] 隐私政策写明**每项权限的用途**，与 Info.plist 的 `UsageDescription` 文案一致 <!-- task:t_5554ce40 -->
- [ ] 隐私政策内容与**实际采集行为一致**（App 内采集但政策没写 = 拒；政策写了但没采 = 可疑） <!-- task:t_2ebdd0e5 -->
- [ ] 隐私政策中已说明「用户主动提交的内容将被收集用于改进产品」（反馈功能） <!-- task:t_0ca092e6 -->

### 5.2 平台隐私声明与表单

- [ ] App Store Connect「App 隐私」问卷已填，且与隐私政策内容一致 <!-- task:t_6930c175 -->
- [ ] Google Play Console「数据安全」表单已填，且与实际采集一致 <!-- task:t_40980b39 -->
- [ ] 隐私问卷与政策内容已按「权限配置」面板生成的清单逐项核对（面板勾了什么，问卷就该选什么） <!-- task:t_7a1fee0a -->
- [ ] iOS **PrivacyInfo.xcprivacy** 已随包提交（App Store Connect 后台可上传） <!-- task:t_de476d18 -->
- [ ] PrivacyInfo.xcprivacy 中声明的 Required Reason API 与代码实际调用一致 <!-- task:t_b7ff98b9 -->
- [ ] 隐私清单里声明的数据类型与 App 隐私问卷**没有矛盾** <!-- task:t_bb2ccb11 -->

### 5.3 用户同意与撤回

- [ ] 首次启动的隐私同意弹窗已实现（Apple 要求：追踪前必须先取得同意） <!-- task:t_989f5496 -->
- [ ] 同意弹窗提供「同意 / 不同意」两个**同等显著**的选项 <!-- task:t_07a1d0f2 -->
- [ ] 不同意时 App 仍可使用核心功能（不得强制同意才能用） <!-- task:t_f60aee0a -->
- [ ] App 内提供**撤回同意**的入口（设置页可重新调整权限与追踪开关） <!-- task:t_b191e903 -->
- [ ] 隐私政策有 App 内入口（设置页），不只是外部网页 <!-- task:t_d0cdb3f6 -->
- [ ] 撤回同意后，追踪 SDK 立即停止上报 <!-- task:t_e1eae161 -->

### 5.4 账号注销与数据主体权利

- [ ] 账号注销入口可达（iOS **强制要求**，隐藏会被拒） <!-- if:hasAccountSystem --> <!-- task:t_bc434831 -->
- [ ] 注销流程在 App 内可完整走完，不依赖客服 <!-- if:hasAccountSystem --> <!-- task:t_ce994e06 -->
- [ ] 注销后数据被真实删除或匿名化 <!-- if:hasAccountSystem --> <!-- task:t_6a5d3450 -->
- [ ] 若有第三方 SDK，注销时同步通知其删除数据 <!-- if:hasAccountSystem --> <!-- task:t_f642b1a5 -->

### 5.5 iOS 权限声明

> 本节**不单独配置**权限。声明文案由「权限配置」面板生成，
> 这里只核对「面板生成的」与「代码实际调用的」是否一致。

- [ ] 面板生成的 `*UsageDescription` 已全部写入 Info.plist，且**文案具体说明用途** <!-- task:t_0911f6f9 -->
- [ ] 面板勾选的权限与代码里**实际调用**的 API 一一对应（不多不少） <!-- task:t_165bf3dd -->
- [ ] 权限弹窗只在用户主动触发相关功能时申请，**不得启动即弹** <!-- task:t_0333b600 -->
- [ ] 用户拒绝权限后，App 仍有合理降级路径（不能崩溃、不能卡死） <!-- task:t_baaadf56 -->
- [ ] 面板里没有勾但代码里用到的权限（如 PhotoKit 保存、蓝牙、ATT），已补勾并重新生成 <!-- task:t_8793689d -->

### 5.6 Android 权限申请

- [ ] 面板生成的 `<uses-permission>` 已全部写入 `AndroidManifest.xml` <!-- task:t_6bc90f79 -->
- [ ] 面板勾选的权限与代码实际调用**完全一致**（不多不少） <!-- task:t_cb588da7 -->
- [ ] 危险权限在运行时动态申请，而非仅在 Manifest 声明 <!-- task:t_1b7eb939 -->
- [ ] Android 13+ 用 `READ_MEDIA_IMAGES` 而非旧的 `READ_EXTERNAL_STORAGE` <!-- task:t_4df29bbe -->
- [ ] Android 12+ 蓝牙用 `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` <!-- task:t_fe196a61 -->
- [ ] Android 13+ 通知用 `POST_NOTIFICATIONS` 并运行时申请 <!-- task:t_4cc648e9 -->
- [ ] 后台位置权限（`ACCESS_BACKGROUND_LOCATION`）已单独申请页面，且确有业务必要 <!-- task:t_75f86cfd -->
- [ ] 权限被拒绝后提供「去设置」引导 <!-- task:t_126de941 -->

### 5.7 权限与隐私的一致性核对

> 这一节是**提交前最后一遍对账**：面板、隐私政策、平台问卷、代码，四个来源必须指向同一件事。

- [ ] 面板生成的隐私政策段落已合并进实际政策页面（不是只留在附录里） <!-- task:t_5d678244 -->
- [ ] 隐私政策里写的权限用途与代码里弹的权限弹窗文案**一致** <!-- task:t_afc28149 -->
- [ ] Google Play 的权限用途说明与 App 内弹窗文案**一致** <!-- task:t_70a9ee0a -->
- [ ] 权限用途说明齐全（相机、麦克风、通知等），不只是一句笼统的「需要权限」 <!-- task:t_3675ba68 -->
- [ ] 未申请的后台权限已在 Manifest 中移除（避免无谓的审核质疑） <!-- task:t_145bce3f -->
- [ ] 敏感权限（健康 / 通讯录）没有作为核心功能的强制前置条件 <!-- task:t_8210733f -->
- [ ] ATT 声明与实际调用一致（面板勾了「跨应用追踪」就必须在代码里弹 ATT；反之没勾就不能调 ATT API） <!-- task:t_9ec219b3 -->
- [ ] 广告归因用到的设备 ID 权限与实际使用一致（面板勾了「跨应用追踪」才声明） <!-- task:t_a9cdcf47 -->

---

## 六、发布前最后 5 件事 <!-- section:s_b8abebc0 -->

- [ ] 线上环境 smoke test：真实设备跑一遍启动 → 订阅 → 统计上报全链路 <!-- task:t_3c876439 -->
- [ ] 用真实账号验证一次完整购买 + 恢复购买 <!-- task:t_d70a7c16 -->
- [ ] 确认 Analytics 后台能收到本次启动的用户与事件 <!-- task:t_8ee63ece -->
- [ ] 确认 Adjust 后台能收到安装 / 归因事件（启用归因时） <!-- task:t_559cbb54 -->
- [ ] 提审截图与实际 App 状态一致（尤其付费墙、隐私弹窗） <!-- task:t_cdebf59a -->
- [ ] 上传用的证书 / 描述文件与 App Store Connect 记录一致，签名未报错 <!-- task:t_a05b02cc -->
- [ ] 开发者账号是正式账号，协议 / 税务 / 银行信息已生效 <!-- task:t_98060006 -->

---

## 七、确认已了解使用说明 <!-- section:s_2de659e4 -->

<!-- GATE -->

> **这是使用本清单的前置条件。**
> 在《使用说明》页面读完并勾选确认之前，上面的所有清单条目都处于锁定状态。

- [ ] 我已阅读《使用说明》，理解「按顺序完成」「破坏性操作二次确认」「权限配置走面板」三条规则 <!-- task:t_c819db4d -->

---
