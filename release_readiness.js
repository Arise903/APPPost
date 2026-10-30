/* Versioned readiness rules; the Python server uses the same policy. */
(function(root){
'use strict';
const DEFAULT_TIME_ZONE='Asia/Shanghai';
function calendarDate(now=new Date(),timeZone=DEFAULT_TIME_ZONE){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timeZone||DEFAULT_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return values.year+'-'+values.month+'-'+values.day;
}
function assess(snapshot,now=new Date()){
 const timeZone=snapshot.release?.timeZone||DEFAULT_TIME_ZONE,today=calendarDate(now,timeZone),items=(snapshot.items||[]).filter(i=>!i.gate&&i.applicable!==false),issues=[];
 let done=0,skipped=0,pending=0;
 const add=(id,text,reason)=>issues.push({id,text,reason});
 for(const item of items){
  if(item.state==='done')done++;else if(item.state==='skip')skipped++;else pending++;
  if(item.required==='off')continue;
  let reason='';
  if(!['done','skip'].includes(item.state))reason='必需项待检查';
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
 const release=snapshot.release||{};
 if(release.strictValidation==='on'){
  for(const [key,label] of [['app','App 名称'],['platform','平台'],['version','版本号'],['build','构建号'],['owner','负责人']])if(!String(release[key]||'').trim())add('__release',label,'发布信息不完整');
  if(snapshot.features?.hasSubscriptions){const products=(snapshot.subscriptions||[]).filter(p=>p.status!=='off');if(!products.length)add('__subscriptions','订阅商品','尚未配置可发布商品');const seen=new Set();for(const p of products){const platform=p.platform||'both';let error=!p.name||p.price===''||p.price===undefined||!Number.isFinite(Number(p.price))||Number(p.price)<0||!/^[A-Z]{3}$/.test(p.currency||'')||!Number.isSafeInteger(Number(p.periodCount))||Number(p.periodCount)<1||!p.benefits||p.status==='draft';if((platform==='ios'||platform==='both')&&!p.iosProductId)error=true;if((platform==='android'||platform==='both')&&(!p.androidProductId||!p.basePlanId))error=true;for(const key of ['iosProductId','androidProductId'])if(p[key]){const id=key+':'+p[key]+(key==='androidProductId'?':'+(p.basePlanId||''):'');if(seen.has(id))error=true;seen.add(id);}if(error)add('__subscriptions',p.name||'未命名商品','商品配置不完整或重复');}}
 }
 if(snapshot.preflight){const report=snapshot.preflight;if(root.ReleaseAnalysis&&report.basis!==root.ReleaseAnalysis.basis(snapshot))add('__preflight','配置预检','发布配置已变化，预检结果需重新生成');else if(report.errors>0)add('__preflight','配置预检',report.errors+' 项配置预检错误未解决');}
 return {policyVersion:3,timeZone,assessedOn:today,total:items.length,done,skipped,pending,blockers:issues.length,missingEvidence:issues.filter(i=>i.reason==='缺少必需证据').length,ready:items.length>0&&!issues.length,issues};
}
root.ReleaseReadiness={assess,calendarDate,DEFAULT_TIME_ZONE};
})(typeof window==='undefined'?globalThis:window);
