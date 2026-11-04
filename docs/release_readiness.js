/* Versioned readiness rules; the Python server uses the same policy. */
(function(root){
'use strict';
const DEFAULT_TIME_ZONE='Asia/Shanghai';
function calendarDate(now=new Date(),timeZone=DEFAULT_TIME_ZONE){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timeZone||DEFAULT_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return values.year+'-'+values.month+'-'+values.day;
}
const MODULE_FEATURES=['hasSubscriptions','hasAdjust','hasFirebase','hasAnalysisApi','hasInitialization','hasSubscriptionEvents','hasPermissions'];
function reviewDiff(before,after){if(JSON.stringify(before)===JSON.stringify(after))return undefined;if(!after||Array.isArray(after)||typeof after!=='object')return after;const patch={};for(const key of new Set([...Object.keys(before||{}),...Object.keys(after)])){if(['__proto__','constructor','prototype'].includes(key))throw Error('不支持的记录字段');const value=reviewDiff(before?.[key],after[key]);if(value!==undefined)patch[key]=value;if(!Object.hasOwn(after,key))patch[key]=null;}return patch;}
function mergeReview(current,patch){if(!patch||Array.isArray(patch)||typeof patch!=='object')return patch;const out={...(current&&typeof current==='object'&&!Array.isArray(current)?current:{})};for(const [key,value] of Object.entries(patch)){if(['__proto__','constructor','prototype'].includes(key))throw Error('不支持的记录字段');if(value===null)delete out[key];else out[key]=mergeReview(out[key],value);}return out;}
function missingModuleItems(module,ids){const known=new Set(ids);return module.items.filter(item=>!known.has(item[0])&&!(module.legacyCoverage?.[item[0]]?.length&&module.legacyCoverage[item[0]].every(id=>known.has(id))));}
function subscriptionEvents(features={}){return !!(features.hasSubscriptions&&(features.hasAdjust||features.hasFirebase||features.hasAnalysisApi));}
function isMandatory(item,snapshot={}){
 const features={...(snapshot.features||{}),hasInitialization:!!(snapshot.features?.hasAdjust||snapshot.features?.hasAnalysisApi),hasSubscriptionEvents:subscriptionEvents(snapshot.features),hasPermissions:(snapshot.selectedPermissions||snapshot.permissions?.selected||[]).length>0};
 return !!(MODULE_FEATURES.includes(item.cond)&&features[item.cond]||item.permissionRule&&features.hasPermissions);
}
function requiredConfig(snapshot={}){
 const features=snapshot.features||{},release=snapshot.release||{},fields=new Map(),add=(key,label)=>fields.set(key,label);
 if(features.hasSubscriptions||features.hasAdjust||features.hasFirebase||features.hasAnalysisApi){add('platform','平台');add('environment','环境');const platform=String(release.platform||'').toLowerCase();if(platform.includes('ios'))add('appIdIOS','iOS 应用标识');if(platform.includes('android'))add('appIdAndroid','Android 应用标识');}
 if(features.hasAdjust)add('adjustAppToken','Adjust appToken');
 if(features.hasFirebase)for(const pair of [['firebaseProjectId','Firebase projectId'],['firebaseAppId','Firebase appId'],['firebaseConfig','Firebase 配置信息']])add(...pair);
 if(features.hasAnalysisApi)for(const pair of [['analysisApiUrl','AnalysisApi 地址'],['analysisApiProjectId','AnalysisApi projectId']])add(...pair);
 if(subscriptionEvents(features))add('subscriptionEventConfig','订阅事件统计配置');
 if((snapshot.selectedPermissions||snapshot.permissions?.selected||[]).length)add('privacyPolicyUrl','隐私政策地址');
 return [...fields].map(([key,label])=>({key,label}));
}
const integrationFields={Adjust:{appToken:'adjustAppToken'},Firebase:{projectId:'firebaseProjectId',appId:'firebaseAppId',config:'firebaseConfig'},AnalysisApi:{url:'analysisApiUrl',projectId:'analysisApiProjectId'}};
const providerFeatures={Adjust:'hasAdjust',Firebase:'hasFirebase',AnalysisApi:'hasAnalysisApi'};
function configurationRelease(snapshot){const release={...(snapshot.release||{})},platform=String(release.platform||'').toLowerCase(),groups={};for(const row of snapshot.integrations||[]){const key=integrationFields[row.provider]?.[row.key];if(key&&row.value&&row.environment===(release.environment||'production')&&(platform==='ios / android'||row.platform===platform)){groups[key]=groups[key]||{};groups[key][row.platform]=row.value;}}for(const [key,values] of Object.entries(groups))release[key]=Object.keys(values).length===1?Object.values(values)[0]:JSON.stringify(values);if((snapshot.subscriptionEvents||[]).length)release.subscriptionEventConfig=JSON.stringify(snapshot.subscriptionEvents);return release;}
function structuredIssues(snapshot,add){
 const release=snapshot.release||{},features=snapshot.features||{},platform=String(release.platform||'').toLowerCase(),platforms=platform==='ios / android'?['ios','android']:['ios','android'].includes(platform)?[platform]:[],rows=snapshot.integrations||[],env=release.environment||'production';
 for(const [provider,map] of Object.entries(integrationFields))if(features[providerFeatures[provider]]&&rows.some(row=>row.provider===provider))for(const target of platforms)for(const key of Object.keys(map)){const matches=rows.filter(row=>row.provider===provider&&row.platform===target&&row.environment===env&&row.key===key);if(matches.length!==1||!matches[0].value?.trim()||matches[0].verification!=='verified'||!matches[0].source?.trim())add('__integrations',provider+' · '+target+' · '+env+' · '+key,matches.length>1?'存在重复配置':'配置缺失或尚未核验');}
 const events=snapshot.subscriptionEvents||[];if(subscriptionEvents(features)&&events.length){for(const [provider,feature] of Object.entries(providerFeatures))if(features[feature])for(const kind of ['purchase_success','purchase_failed','purchase_cancelled','restore']){const matches=events.filter(row=>row.target===provider&&row.kind===kind);if(!matches.some(row=>row.event?.trim()&&row.trigger?.trim()&&row.source?.trim()&&row.verification==='verified'&&(!['purchase_success','restore'].includes(kind)||row.dedup?.trim()&&row.productField?.trim()&&row.orderField?.trim())&&(kind!=='purchase_success'||row.amountField?.trim()&&row.currencyField?.trim())))add('__events',provider+' · '+kind,'事件映射缺失或尚未核验');}}
}
function permissionTexts(profiles,permissions){return Object.fromEntries((permissions.selected||[]).map(id=>{const p=(profiles.permissions||[]).find(p=>p.id===id)||{},i=p.ios||{},a=p.android||{},key=i.infoplist_keys?.[0]||i;return [id,{zh:permissions.descs?.[id]||key.desc||a.desc||permissions.descsEn?.[id]||'',en:permissions.descsEn?.[id]||key.desc_en||a.desc_en||permissions.descs?.[id]||''}];}));}
function assess(snapshot,now=new Date()){
 const timeZone=snapshot.release?.timeZone||DEFAULT_TIME_ZONE,today=calendarDate(now,timeZone),items=(snapshot.items||[]).filter(i=>!i.gate&&i.applicable!==false),issues=[];
 let done=0,skipped=0,pending=0;
 const add=(id,text,reason)=>{if(id==='__release'&&issues.some(issue=>issue.id===id&&issue.text===text))return;issues.push({id,text,reason});};
 for(const item of items){
  if(item.state==='done')done++;else if(item.state==='skip')skipped++;else pending++;
  const mandatory=isMandatory(item,snapshot);
  if(item.required==='off'&&!mandatory)continue;
  let reason='';
  if(!['done','skip'].includes(item.state))reason='必需项待检查';
  else if(item.state==='skip'&&mandatory)reason='启用模块的必检项不可跳过';
  else if(item.state==='skip'){
   if(!String(item.reason||'').trim())reason='跳过缺少原因';
   else if(item.exceptionType&&item.exceptionType!=='legacy'){
    if(!['not-applicable','deferred','risk-accepted'].includes(item.exceptionType))reason='跳过类型无效';
    else if(item.exceptionType==='deferred')reason='暂缓项尚未解决';
    else if(!String(item.exceptionOwner||'').trim()||!/^\d{4}-\d{2}-\d{2}$/.test(item.reviewDue||''))reason='例外缺少负责人或复查期限';
    else if(item.reviewDue<today)reason='例外已到期，需重新复查';
    else if(item.exceptionType==='risk-accepted'&&(item.approvalStatus!=='approved'||!String(item.approvalBy||'').trim()||!/^\d{4}-\d{2}-\d{2}$/.test(item.approvalDate||'')||item.approvalDate>today))reason='风险接受缺少有效审批记录';
   }
  }else if(item.state==='done'){
   let ids=[];try{ids=JSON.parse(item.attachmentIds||'[]');if(!Array.isArray(ids))ids=[];}catch(_){}
   const files=ids.map(id=>snapshot.evidenceFiles?.[id]),hasAsset=f=>!!f&&(snapshot.assetIds||[]).includes(f.assetId),validFiles=files.filter(f=>hasAsset(f)&&(!f.expiresAt||f.expiresAt>=today));
   const hasText=!!String(item.evidence||'').trim(),textValid=hasText&&(!item.evidenceExpiresAt||item.evidenceExpiresAt>=today);
   if(ids.some((id,index)=>!hasAsset(files[index])))reason='关联附件缺失';
   else if((hasText&&!textValid||files.some(f=>f?.expiresAt&&f.expiresAt<today))&&!textValid&&!validFiles.length)reason='验证证据已过期';
   else if(item.evidenceRequired==='on'&&!textValid&&!validFiles.length)reason='缺少必需证据';
  }
  if(reason)add(item.id,item.text,reason);
 }
 for(const [key,value] of Object.entries(snapshot.featureStates||{}))if(value==='unknown')add('__features',({hasSubscriptions:'订阅管理',hasAdjust:'Adjust',hasFirebase:'Firebase',hasAnalysisApi:'AnalysisApi',hasAccountSystem:'账号系统',hasPush:'推送',hasFeedbackSystem:'反馈',targetMinors:'未成年用户'})[key]||key,'功能使用情况待确认');
 for(const id of snapshot.selectedPermissions||snapshot.permissions?.selected||[]){const r=snapshot.permissionReviews?.[id]?.zh,text=snapshot.permissionTexts?.[id]?.zh;if(!r||r.state!=='verified'||!r.source?.trim()||!r.checkedAt||!r.text?.trim()||text!==undefined&&text!==r.text)add('__permissions',id,'权限用途说明尚未核对或已变更');}
 structuredIssues(snapshot,add);
 const release=configurationRelease(snapshot);
 for(const {key,label} of requiredConfig(snapshot))if(!String(release[key]||'').trim())add('__release',label,'已启用模块缺少必需配置');
 if(release.strictValidation==='on'){
  for(const [key,label] of [['app','App 名称'],['platform','平台'],['version','版本号'],['build','构建号'],['owner','负责人']])if(!String(release[key]||'').trim())add('__release',label,'发布信息不完整');
 }
 if(snapshot.features?.hasSubscriptions){const products=(snapshot.subscriptions||[]).filter(p=>p.status!=='off');if(!products.length)add('__subscriptions','订阅商品','尚未配置可发布商品');const seen=new Set();for(const p of products){const projectPlatform=String(snapshot.release?.platform||'').toLowerCase(),rawPlatform=p.platform||(['ios','android'].includes(projectPlatform)?projectPlatform:'both'),platform=['ios','android','both'].includes(rawPlatform)?rawPlatform:'both';let error=p.price==null||String(p.price).trim()===''||!Number.isFinite(Number(p.price))||Number(p.price)<0||!/^[A-Z]{3}$/.test(p.currency||'')||!Number.isSafeInteger(Number(p.periodCount))||Number(p.periodCount)<1||!['day','week','month','year','custom'].includes(p.period)||p.period==='custom'&&!String(p.customPeriod||'').trim();if((platform==='ios'||platform==='both')&&!String(p.iosProductId||'').trim())error=true;if((platform==='android'||platform==='both')&&!String(p.androidProductId||'').trim())error=true;for(const key of (platform==='ios'?['iosProductId']:platform==='android'?['androidProductId']:['iosProductId','androidProductId']))if(p[key]){const id=key+':'+p[key]+(key==='androidProductId'?':'+(p.basePlanId||''):'');if(seen.has(id))error=true;seen.add(id);}if(error)add('__subscriptions',p.name||'未命名商品','商品配置不完整或重复');}}
 if(snapshot.preflight){const report=snapshot.preflight;if(root.ReleaseAnalysis&&report.basis!==root.ReleaseAnalysis.basis(snapshot))add('__preflight','配置预检','发布配置已变化，预检结果需重新生成');else if(report.errors>0)add('__preflight','配置预检',report.errors+' 项配置预检错误未解决');}
 return {policyVersion:6,timeZone,assessedOn:today,total:items.length,done,skipped,pending,blockers:issues.length,missingEvidence:issues.filter(i=>i.reason==='缺少必需证据').length,ready:items.length>0&&!issues.length,issues};
}
root.ReleaseReadiness={assess,calendarDate,DEFAULT_TIME_ZONE,isMandatory,requiredConfig,subscriptionEvents,missingModuleItems,configurationRelease,structuredIssues,permissionTexts,reviewDiff,mergeReview};
})(typeof window==='undefined'?globalThis:window);
