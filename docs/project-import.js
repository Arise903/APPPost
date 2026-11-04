/* Existing repositories -> a portable Markdown checklist with explicit import metadata. */
(function(global){
'use strict';
const FORMAT='release-desk-source/v1';
function metadata(document){
 const markers=[...document.matchAll(/<!--\s*RELEASE_DESK_IMPORT\b([\s\S]*?)-->/g)];
 if(!markers.length){if(/<!--\s*RELEASE_DESK_IMPORT\b/.test(document))throw Error('工程文档的导入配置注释未闭合');return null;}
 if(markers.length!==1)throw Error('工程文档只能包含一份 RELEASE_DESK_IMPORT 配置');
 let value;try{value=JSON.parse(markers[0][1].trim());}catch(_){throw Error('工程文档的导入配置不是有效 JSON，请让 AI 修正文档');}
 if(!value||value.format!==FORMAT)throw Error('工程文档格式不受支持，请使用最新的 AI 采集说明');
 return value;
}
function read(document,data){
 const value=metadata(document);if(!value)return {document};
 const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
 if(!object(value.release)||!object(value.features)||!object(value.permissions))throw Error('工程文档缺少发布信息、功能或权限配置');
 const fields=new Map((data.configFields||[]).map(f=>[f.key,f]));
 const release={};for(const [key,text] of Object.entries(value.release)){const field=fields.get(key);if(!field)throw Error('不支持的发布字段：'+key);if(typeof text!=='string'||text.length>field.maxLength)throw Error('发布字段格式无效：'+key);if(text)release[key]=text;}
 if(release.platform&&!['iOS','Android','iOS / Android'].includes(release.platform))throw Error('平台必须为 iOS、Android 或 iOS / Android');
 if(release.status&&!['planning','review','released'].includes(release.status))throw Error('发布状态无效');
 if(release.strictValidation&&!['on','off'].includes(release.strictValidation))throw Error('完整发布检查须为 on 或 off');
 const keys=['hasAccountSystem','hasSubscriptions','hasPush','hasFeedbackSystem','targetMinors','hasAdjust','hasAnalysisApi','hasFirebase'];
 if(Object.keys(value.features).some(key=>!keys.includes(key))||keys.some(key=>typeof value.features[key]!=='boolean'))throw Error('工程文档需明确填写八项功能开关；未确认项请保留在待核对清单中');
 const featureStates=value.featureStates||Object.fromEntries(keys.map(key=>[key,value.features[key]?'on':'off']));if(!object(featureStates)||Object.entries(featureStates).some(([key,state])=>!keys.includes(key)||!['on','off','unknown'].includes(state)))throw Error('功能确认状态无效');for(const key of keys)if(featureStates[key])value.features[key]=featureStates[key]!=='off';
 const permissions=value.permissions,known=new Set(data.profiles.permissions.map(p=>p.id));
 if(!Array.isArray(permissions.selected)||permissions.selected.some(id=>!known.has(id))||new Set(permissions.selected).size!==permissions.selected.length)throw Error('工程文档包含重复或不支持的权限');
 for(const key of ['descs','descsEn'])if(!object(permissions[key])||Object.entries(permissions[key]).some(([id,text])=>!known.has(id)||typeof text!=='string'||text.length>10000))throw Error('权限用途描述无效');
 const subscriptions=value.subscriptions||[];
 if(!Array.isArray(subscriptions)||subscriptions.length>100||subscriptions.some(p=>!object(p)||Object.values(p).some(v=>typeof v!=='string'||v.length>4000)))throw Error('订阅商品配置无效');
 return {document:document.replace(/<!--\s*RELEASE_DESK_IMPORT\b[\s\S]*?-->/,'').trim(),features:value.features,featureStates,permissions,review:{release,items:{},history:[],subscriptions,integrations:value.integrations||[],subscriptionEvents:value.subscriptionEvents||[]}};
}
function prompt(data){
 const release=Object.fromEntries(data.configFields.map(f=>[f.key,'']));release.status='planning';release.strictValidation='on';
 const features=Object.fromEntries(['hasAccountSystem','hasSubscriptions','hasPush','hasFeedbackSystem','targetMinors','hasAdjust','hasAnalysisApi','hasFirebase'].map(key=>[key,true]));
 const example={format:FORMAT,release,integrations:[],subscriptionEvents:[],features,featureStates:Object.fromEntries(Object.keys(features).map(key=>[key,'unknown'])),permissions:{selected:[],descs:{},descsEn:{}},subscriptions:[]};
 return `# 已有工程接入 Release Desk：AI 采集说明

请在当前工程根目录工作，读取实际源码及构建配置，生成可直接导入 Release Desk 的「已有工程上架清单.md」。这是采集与文档任务：只新建该 Markdown 文件，不修改业务代码或现有文件，不执行发布、上传或付费操作。

## 采集范围

1. 记录工程名称、仓库相对路径、当前分支和提交（可读取时），识别 iOS / Android / Flutter / React Native 等实际技术栈、多应用、多 target、flavor 与构建环境。若存在多个应用，请为每个应用分别生成文档；无法确定发布目标时明确询问，不能混合不同应用或环境的配置。
2. 读取实际存在的构建与配置文件，如 pubspec.yaml、package.json、Xcode project / xcconfig / Info.plist / entitlements、Gradle / AndroidManifest.xml、环境配置与打包脚本。追踪变量引用和 Release 覆盖值，不把 Debug 或示例值当作生产配置；无需安装依赖或运行构建。
3. 采集应用名、应用标识、版本、构建号、环境、API 地址、隐私政策/协议/支持/反馈地址、SDK 版本与 Android SDK 级别。双平台版本不同且字段无法同时表示时留空，并在正文分平台列出。
4. 核对账号、订阅、推送、反馈、未成年人、Adjust、Firebase、AnalysisApi 的实际实现与初始化。依赖存在不等于功能已启用；已确认使用填 true，已确认未使用才填 false。未确认开关暂填 true 保留必检项，并将对应 featureStates 填 unknown；已确认启用填 on，已确认未使用填 off，并在「待确认信息」列出缺少的证据及确认办法；不能因没有找到某段代码就关闭检查。
5. 从权限声明及调用点整理权限用途，区分声明、实际使用、请求时机与用户拒绝后的行为。权限 ID 仅使用下方清单；发现列表之外的权限时在正文列出待人工核对，不编造 ID。
6. 从商品定义、购买代码、StoreKit 文件与配置采集订阅商品 ID、平台、周期、币种、价格、试用与优惠；代码中没有的商店配置留空，不能推测线上价格或审核状态。已发现的商品写入 subscriptions，所有字段值必须为字符串。常用字段：id、name、platform（ios/android/both）、iosProductId、androidProductId、basePlanId、period（week/month/year/custom）、periodCount、customPeriod、currency、price、status（draft）。
7. 不输出私钥、签名密码、访问令牌、服务端密钥、用户数据、带凭据的 URL 或完整环境文件。发现敏感项只记录字段名称和文件相对路径。客户端公开标识可填写；不能确定是否可公开的值留空并说明。配置值不得包含 HTML 注释结束符。

## 重点采集与必检规则

订阅管理、Adjust、Firebase、AnalysisApi 自有统计、权限说明及各自配置只要实际启用，就是必须核对的项目，不能标为可选、已完成或用跳过代替。未使用可关闭；不确定保持开启并列为待确认。

- 订阅管理：逐平台核对商品 ID、base plan（实际存在时）、价格/币种/周期、环境、商品加载、购买与恢复、订单校验、权益发放、续费、到期和退款。区分仓库事实与商店后台待提供值。
- Adjust：采集 SDK 版本、各平台 appToken、环境和业务开关、初始化位置/顺序、同意或 ATT 分支、幂等、deep link、归因与收入事件、事件 token 配置。仅有依赖不能判定启用；未执行的分支也要记录。
- Firebase：采集各平台 google-services.json / GoogleService-Info.plist / firebase_options 等实际配置来源、projectId/appId/应用标识、环境覆盖、初始化位置与所用产品（Analytics、Crashlytics、Messaging 等）、采集开关和同意策略。firebaseConfig 字符串中只记录公开配置映射、文件相对路径与核对结果，不能粘贴服务账号或服务端密钥。
- AnalysisApi：采集生产地址/projectId、UUID 生成与生命周期、用户与 token 上报、事件队列、补报、有限重试/后台暂停、失败降级、初始化与归因链路的关系。不得输出用户 token 内容。
- 订阅事件统计：只要 hasSubscriptions 为 true，且 hasAdjust、hasFirebase、hasAnalysisApi 任意为 true，即自动必检，不新增独立开关。追踪各已用目标的事件调用与封装：发起、成功、失败、取消、恢复，以及续费、到期、退款的客户端/服务端来源；记录「事件名 | 触发位置 | 目标 SDK/接口 | 商品/订单字段 | 金额与币种 | 去重方式 | 源码依据 | 待确认」。区分业务事件名、SDK 名和 Adjust event token，不编造映射。把这份映射序列化为文本放入 release.subscriptionEventConfig，未知部分保留正文待核对，整个配置未知则该字段留空。
- 权限说明：默认使用通用文档，逐项对照实际权限声明、调用点、用途、请求时机、拒绝/受限行为及隐私文档，识别通用文案不能覆盖的特殊目的。已确认的特殊用途填 permissions.descs/descsEn，并保留中英文区别；不得强行改回通用文案，不得承诺未核实的“不上传”“不保存”等行为。
- 配置：上述模块的环境、应用标识及必需配置均要提供源码依据。缺字段应列为发布阻塞项，不能以 strictValidation=off 规避。仅记录密钥字段是否存在及其来源，不导出秘密值。

## 真实性与证据

每项结论提供「相对文件路径:行号 + 关键符号/配置名」，区分已从源码确认、推断、待人工确认。无法访问或解析的文件明确记录，不能声称已扫描。源码存在不代表真机通过、商店后台配置正确或已发布。所有发布检查项保持 - [ ]；不要自动勾选完成，不生成审批、负责人、日期或测试证据。

## 结构化配置与事件表

同时填写 integrations 和 subscriptionEvents 数组；只记录源码能够确认的值，无法确认时保留空数组，并在正文列为待确认。所有行字段为字符串，核对状态 verification 固定 pending（源码事实不等于用户已完成核验）。

integrations 每行字段：id（唯一标识）、provider（Adjust/Firebase/AnalysisApi）、platform（ios/android）、environment、key、value、source（相对路径:行号）、verification。Adjust 的 key 使用 appToken；Firebase 使用 projectId/appId/config；AnalysisApi 使用 url/projectId。不同平台或环境分开成行，不合并 Token 或 appId。秘密值不输出。

subscriptionEvents 每行字段：id、kind（purchase_started/purchase_success/purchase_failed/purchase_cancelled/restore/renewal/expiry/refund）、event（实际事件名）、target（Adjust/Firebase/AnalysisApi）、trigger（触发位置）、productField、orderField、amountField、currencyField、dedup、source、verification。一个事件发给多个 SDK 时分行记录。无法核实的生命周期回调明确写待确认，不虚构事件。

## 输出文件格式

直接写入 UTF-8 的 .md 文件，不要用代码围栏包住全文。文件第一行为 # 实际应用名称 · 上架检查清单。紧接着放下面的 HTML 注释，并将 JSON 示例中的值替换为实际采集结果。只出现一份 RELEASE_DESK_IMPORT，必须是合法 JSON，无注释和尾逗号；未知字符串留空，布尔值不可写成字符串。format 保持原值，键名不能翻译。正文未知项写「待确认」，不要将该词填入结构化字段。

<!-- RELEASE_DESK_IMPORT
${JSON.stringify(example,null,2)}
-->

发布字段对照：
${data.configFields.map(f=>`- ${f.key}：${f.label}（最多 ${f.maxLength} 字符）`).join('\n')}

platform 只用 iOS、Android 或 iOS / Android。environment 按实际值填写，未知留空。status 固定 planning，strictValidation 固定 on；timeZone 未经用户确认留空。date、owner、targetDate 未经用户提供留空。

允许的权限 ID：
${data.profiles.permissions.map(p=>`- ${p.id}：${p.name}`).join('\n')}

## Markdown 正文结构

在元数据后加入以下章节：
- ## 工程概况：扫描范围、目标应用、分支/提交、技术栈、环境及限制。
- ## 工程配置与源码依据：表格列为「配置项 | 实际值 | 源码依据 | 确认状态」。配置项使用上方字段的中文名称；未知值在正文中写待确认，敏感值仅注明已配置/待确认。不要输出可用密钥。
- ## 功能、权限与订阅依据：分别建立订阅管理、Adjust、Firebase、AnalysisApi、订阅事件统计和权限说明的小节，逐项写清源码事实、启用状态、配置及后台待核对内容；不适用的小节明确写已确认未使用和依据。
- ## 待确认信息：列出缺失字段、未知功能、冲突配置、需要人工提供的资料与确认方法。
- ## 上架检查清单：按该工程实际情况整理基础信息、生产构建、隐私权限、账号、订阅支付、SDK 初始化、真机验证和商店材料等章节，用 - [ ] 创建可操作的检查项。至少包含一个检查项。不要仅生成项目介绍。可使用 ### 子标题，避免重复的 task ID；无需手写 task/section ID，工作台会生成。

检查文件：JSON 能解析；字段来自允许列表；功能八项齐全；权限 ID 合法；至少一个未完成检查项；每个重要配置可追溯或明确待确认；没有敏感数据。完成后告知文件路径和仍需人工确认的信息。用户将回到「新建 / 导入项目」，选择明文文件导入该 .md；若更新已有工作台项目，仅采用用户勾选的发布配置字段，保留现有进度。
`;
}
const api={read,prompt,FORMAT};if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.ProjectImport=api;
})(typeof window!=='undefined'?window:globalThis);
