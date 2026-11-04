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
 const permissions=value.permissions,known=new Set(data.profiles.permissions.map(p=>p.id));
 if(!Array.isArray(permissions.selected)||permissions.selected.some(id=>!known.has(id))||new Set(permissions.selected).size!==permissions.selected.length)throw Error('工程文档包含重复或不支持的权限');
 for(const key of ['descs','descsEn'])if(!object(permissions[key])||Object.entries(permissions[key]).some(([id,text])=>!known.has(id)||typeof text!=='string'||text.length>10000))throw Error('权限用途描述无效');
 const subscriptions=value.subscriptions||[];
 if(!Array.isArray(subscriptions)||subscriptions.length>100||subscriptions.some(p=>!object(p)||Object.values(p).some(v=>typeof v!=='string'||v.length>4000)))throw Error('订阅商品配置无效');
 return {document:document.replace(/<!--\s*RELEASE_DESK_IMPORT\b[\s\S]*?-->/,'').trim(),features:value.features,permissions,review:{release,items:{},history:[],subscriptions}};
}
function prompt(data){
 const release=Object.fromEntries(data.configFields.map(f=>[f.key,'']));release.status='planning';release.strictValidation='on';
 const features=Object.fromEntries(['hasAccountSystem','hasSubscriptions','hasPush','hasFeedbackSystem','targetMinors','hasAdjust','hasAnalysisApi','hasFirebase'].map(key=>[key,false]));
 const example={format:FORMAT,release,features,permissions:{selected:[],descs:{},descsEn:{}},subscriptions:[]};
 return `# 已有工程接入 Release Desk：AI 采集说明

请在当前工程根目录工作，读取实际源码及构建配置，生成可直接导入 Release Desk 的「已有工程上架清单.md」。这是采集与文档任务：只新建该 Markdown 文件，不修改业务代码或现有文件，不执行发布、上传或付费操作。

## 采集范围

1. 记录工程名称、仓库相对路径、当前分支和提交（可读取时），识别 iOS / Android / Flutter / React Native 等实际技术栈、多应用、多 target、flavor 与构建环境。若存在多个应用，请为每个应用分别生成文档；无法确定发布目标时明确询问，不能混合不同应用或环境的配置。
2. 读取实际存在的构建与配置文件，如 pubspec.yaml、package.json、Xcode project / xcconfig / Info.plist / entitlements、Gradle / AndroidManifest.xml、环境配置与打包脚本。追踪变量引用和 Release 覆盖值，不把 Debug 或示例值当作生产配置；无需安装依赖或运行构建。
3. 采集应用名、应用标识、版本、构建号、环境、API 地址、隐私政策/协议/支持/反馈地址、SDK 版本与 Android SDK 级别。双平台版本不同且字段无法同时表示时留空，并在正文分平台列出。
4. 核对账号、订阅、推送、反馈、未成年人、Adjust、Firebase、AnalysisApi 的实际实现与初始化。依赖存在不等于功能已启用；未确认开关暂填 false，并在「待确认信息」中注明可能被隐藏的清单和确认办法。确认启用后填写 true。
5. 从权限声明及调用点整理权限用途，区分声明、实际使用、请求时机与用户拒绝后的行为。权限 ID 仅使用下方清单；发现列表之外的权限时在正文列出待人工核对，不编造 ID。
6. 从商品定义、购买代码、StoreKit 文件与配置采集订阅商品 ID、平台、周期、币种、价格、试用与优惠；代码中没有的商店配置留空，不能推测线上价格或审核状态。已发现的商品写入 subscriptions，所有字段值必须为字符串。常用字段：id、name、platform（ios/android/both）、iosProductId、androidProductId、basePlanId、period（week/month/year/custom）、periodCount、customPeriod、currency、price、status（draft）。
7. 不输出私钥、签名密码、访问令牌、服务端密钥、用户数据、带凭据的 URL 或完整环境文件。发现敏感项只记录字段名称和文件相对路径。客户端公开标识可填写；不能确定是否可公开的值留空并说明。配置值不得包含 HTML 注释结束符。

## 真实性与证据

每项结论提供「相对文件路径:行号 + 关键符号/配置名」，区分已从源码确认、推断、待人工确认。无法访问或解析的文件明确记录，不能声称已扫描。源码存在不代表真机通过、商店后台配置正确或已发布。所有发布检查项保持 - [ ]；不要自动勾选完成，不生成审批、负责人、日期或测试证据。

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
- ## 功能、权限与订阅依据：逐项写清源码事实、启用状态和需在后台核对的内容。
- ## 待确认信息：列出缺失字段、未知功能、冲突配置、需要人工提供的资料与确认方法。
- ## 上架检查清单：按该工程实际情况整理基础信息、生产构建、隐私权限、账号、订阅支付、SDK 初始化、真机验证和商店材料等章节，用 - [ ] 创建可操作的检查项。至少包含一个检查项。不要仅生成项目介绍。可使用 ### 子标题，避免重复的 task ID；无需手写 task/section ID，工作台会生成。

检查文件：JSON 能解析；字段来自允许列表；功能八项齐全；权限 ID 合法；至少一个未完成检查项；每个重要配置可追溯或明确待确认；没有敏感数据。完成后告知文件路径和仍需人工确认的信息。用户将回到「新建 / 导入项目」，选择明文文件导入该 .md；若更新已有工作台项目，仅采用用户勾选的发布配置字段，保留现有进度。
`;
}
const api={read,prompt,FORMAT};if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.ProjectImport=api;
})(typeof window!=='undefined'?window:globalThis);
