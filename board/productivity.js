/* Common workflow across file, Pages and cloud storage adapters. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
let busy=false,aiExporting=false;
function categories(result){return [
 ['必检待完成',result.issues.filter(i=>i.reason==='必需项待检查')],
 ['证据需补齐',result.issues.filter(i=>/证据|附件/.test(i.reason))],
 ['例外需处理',result.issues.filter(i=>/例外|跳过|暂缓|审批/.test(i.reason))],
 ['配置需完善',result.issues.filter(i=>i.id.startsWith('__'))]
];}
/* 导入的清单常带一张从分支源码提取的「配置项 / 值」表。发布信息还没保存过这些字段时，
   先显示表里已提取的值，避免明明提取到了却显示「未填写」。 */
const RELEASE_DOC_LABELS={appIdAndroid:['Android 应用标识','应用标识'],privacyPolicyUrl:['隐私政策地址','隐私政策'],termsUrl:['用户协议地址','用户协议'],supportUrl:['用户支持地址','支持地址'],feedbackUrl:['反馈地址','反馈服务地址'],analysisApiUrl:['AnalysisApi 地址','Analysis API 地址','自有统计地址'],analysisApiProjectId:['AnalysisApi projectId','AnalysisApi projectID','统计 projectId'],adjustTokenSource:['Adjust Token 配置位置','Adjust Token 存放位置','Adjust Token','Adjust'],minAndroidSdk:['最低 Android SDK','minSdk'],compileSdk:['compileSdk'],targetSdk:['targetSdk']};
const RELEASE_KEY_ALIASES={analysisApiProjectId:['analysisProjectId','analysisProjectID'],analysisApiUrl:['analysisBaseUrl','analysisApiBaseUrl'],adjustTokenSource:['adjustToken','adjustAppToken']};
function documentConfigValues(){
 const values=new Map();
 const scan=blocks=>{for(const block of blocks||[]){if(block.type!=='table')continue;for(const row of block.rows||[]){if(row.length<2)continue;const label=String(row[0]||'').trim();if(label&&!values.has(label))values.set(label,String(row[1]||'').trim());}}};
 scan(DATA&&DATA.preamble);
 for(const section of (DATA&&DATA.sections)||[])scan(section.blocks);
 return values;
}
function configValue(release,key,doc){
 const direct=String(release[key]||'').trim();if(direct)return direct;
 for(const alias of RELEASE_KEY_ALIASES[key]||[]){const value=String(release[alias]||'').trim();if(value)return value;}
 for(const label of RELEASE_DOC_LABELS[key]||[]){const value=doc.get(label);if(value)return value;}
 return '';
}
function refresh(){
 if(!DATA)return;
 const config=$('projectConfigurationLines'),release=reviewData.release||{},features=DATA.features||{},names=new Map((EMBEDDED_PROFILES.permissions||[]).map(permission=>[permission.id,permission.name]));
 const doc=documentConfigValues();
 const entries=[['应用名称',configValue(release,'app',doc)||DATA.title],['发布平台',configValue(release,'platform',doc)],['版本 / 构建',[release.version,release.build].filter(Boolean).join(' / ')],['iOS 应用标识',configValue(release,'appIdIOS',doc)],['Android 应用标识',configValue(release,'appIdAndroid',doc)],['发布环境',configValue(release,'environment',doc)],['API 基础地址',configValue(release,'apiBaseUrl',doc)],['隐私政策地址',configValue(release,'privacyPolicyUrl',doc)],['用户协议地址',configValue(release,'termsUrl',doc)],['用户支持地址',configValue(release,'supportUrl',doc)],['反馈地址',configValue(release,'feedbackUrl',doc)],['AnalysisApi 地址',configValue(release,'analysisApiUrl',doc)],['AnalysisApi projectId',configValue(release,'analysisApiProjectId',doc)],['Adjust Token 配置位置',configValue(release,'adjustTokenSource',doc)],['最低 Android SDK',configValue(release,'minAndroidSdk',doc)],['compileSdk',configValue(release,'compileSdk',doc)],['targetSdk',configValue(release,'targetSdk',doc)],['负责人',configValue(release,'owner',doc)],['目标发布日期',configValue(release,'targetDate',doc)],['发布时区',release.timeZone],['订阅商品',features.hasSubscriptions?'已启用':'未启用'],['Adjust 广告归因',features.hasAdjust?'已启用':'未启用'],['AnalysisApi 自有统计',features.hasAnalysisApi?'已启用':'未启用'],['初始化流程核对',features.hasAdjust||features.hasAnalysisApi?'已启用':'未启用'],['账号系统',features.hasAccountSystem?'已启用':'未启用'],['推送',features.hasPush?'已启用':'未启用'],['反馈系统',features.hasFeedbackSystem?'已启用':'未启用'],['面向未成年用户',features.targetMinors?'是':'否'],['权限',(DATA.permSelected||[]).map(id=>names.get(id)||id).join('、')]];
 for(const product of reviewData.subscriptions||[])entries.push(['订阅商品 ID',[product.iosProductId,product.androidProductId].filter(Boolean).join(' / ')]);
 const configSignature=JSON.stringify(entries);if(config&&config.dataset.signature!==configSignature){config.dataset.signature=configSignature;const table=document.createElement('table');table.className='project-configuration-table';const body=document.createElement('tbody');for(const [label,value] of entries){const row=document.createElement('tr'),key=document.createElement('th'),cell=document.createElement('td');key.scope='row';key.textContent=label;cell.textContent=String(value||'未填写');row.append(key,cell);body.append(row);}table.append(body);config.replaceChildren(table);}
 const snapshot=releaseSnapshot(),result=snapshot.readiness,host=$('releasePriorities');
 const signature=JSON.stringify(result);if(host.dataset.signature!==signature){
  host.dataset.signature=signature;host.replaceChildren();
  const title=document.createElement('strong');title.textContent=result.ready?'检查已就绪，可以整理发布结论':'下一步：处理 '+result.blockers+' 个发布阻塞项';host.append(title);
  const group=document.createElement('div');group.className='priority-metrics';
  for(const [label,issues] of categories(result)){const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=label+' '+issues.length;button.disabled=!issues.length;button.onclick=()=>{const index=result.issues.indexOf(issues[0]);$('readinessPanel').open=true;$('readinessIssues').children[index]?.querySelector('button')?.click();};group.append(button);}host.append(group);
  if(result.issues.length){const next=document.createElement('p');next.textContent='优先处理：'+result.issues[0].text+' · '+result.issues[0].reason;host.append(next);}
 }
 const progress=ReleaseAnalysis.aiReviewProgress(snapshot),exportButton=$('aiReviewExport'),exportHint=$('aiReviewExportHint');exportButton.disabled=!gateDone||!progress.complete||!online||aiExporting;exportButton.title=progress.complete?'导出已保存的 AI 排查文档':'进度达到 100% 后可导出';exportHint.textContent=!gateDone?'请先阅读并确认使用说明。':progress.complete?'进度已达 100%，保存全部修改后可导出。':!progress.total?'暂无适用检查项，不能导出；请检查项目配置。':'进度 '+progress.percent+'% · 还需完成 '+progress.remaining+' 项，达到 100% 后可导出（跳过不计为完成）。';
 const save=$('saveAll');save.disabled=!online||window.RELEASE_CLOUD?.role==='viewer'||busy||savingOperations>0;save.textContent=busy?'正在保存全部…':'保存全部';
}
async function submitDraft(id,stillDirty){
 const form=$(id);if(!form.reportValidity())throw Error('请补全表单中标出的字段');
 await form.onsubmit({preventDefault(){}});
 if(stillDirty())throw Error('表单尚未保存，请查看错误并重试');
}
async function saveAll(){
 if(busy)return false;
 if(!online){toast('请先连接存储服务');return false;}
 if(window.RELEASE_CLOUD?.role==='viewer'){toast('当前项目为只读');return false;}
 busy=true;refresh();
 // Block edits while sequential writes use the latest revision. Each successful
 // write remains saved; failed and unattempted drafts are retained for retry.
 const blocker=document.createElement('dialog');blocker.className='app-dialog';blocker.textContent='正在保存全部修改，请稍候…';blocker.addEventListener('cancel',e=>e.preventDefault());document.body.append(blocker);blocker.showModal();
 try{
  await saveQueue.catch(()=>{});
  if(saveConflict)throw Error('存在版本冲突，请先查看冲突差异');
  const features=featureHasChanges()?{...DATA.features}:null;
  const revealInitialization=features?.hasAdjust&&!featureSnapshot?.hasAdjust;
  const permissions=permDirty?{selected:[...permSelected],descs:{...permDescs},descsEn:{...permDescsEn}}:null;
  clearTimeout(permSaveTimer);
  if(itemReviewDirty())await submitDraft('itemReviewForm',itemReviewDirty);
  if(releaseEditorDirty())await submitDraft('releaseEditForm',releaseEditorDirty);
  if(features){const d=await api('/api/features',{features});DATA=mergeItems(d);featureSnapshot=null;closeFeatPanel();render();refreshFeatUI();if(revealInitialization)revealInitializationChecks();}
  if(subscriptionHasChanges()){await submitDraft('subscriptionForm',subscriptionHasChanges);}
  if(permissions){const d=await api('/api/perm-write',permissions);DATA=mergeItems(d);permDirty=false;setPermSaveState('saved','✓ 已保存权限配置');render();}
  if(dirty&&!await saveProgress({all:true}))throw Error('检查进度未保存');
  if(boardPendingDetails().length)throw Error('仍有未保存内容：'+boardPendingDetails().join('、'));
  saveFailure='';toast('全部修改已保存');return true;
 }catch(error){saveFailure=error.message;persistFormDraft();toast('保存未完成：'+error.message+'。未完成草稿已保留。');return false;}
 finally{blocker.close();blocker.remove();busy=false;updateSaveStatus();refresh();}
}
async function exportAIReview(){
 const button=$('aiReviewExport');if(button.disabled)return;aiExporting=true;button.disabled=true;
 try{
  await saveQueue.catch(()=>{});
  if(boardPendingDetails().length||saveFailure||saveConflict){toast('请先保存全部修改并处理保存错误，再导出 AI 排查文档');return;}
  if(!online){toast('请连接存储服务后导出最新已保存配置');return;}
  const data=await api('/api/list');
  const snapshot=ReleaseAnalysis.aiReviewSnapshot(data,EMBEDDED_PROFILES);
  const markdown=ReleaseAnalysis.aiReviewMarkdown(snapshot,EMBEDDED_PROFILES);
  const name=(snapshot.release.app||data.title||'项目').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100);
  const url=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name+'-AI排查-'+ReleaseReadiness.calendarDate(undefined,snapshot.release.timeZone)+'.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('AI 排查文档已导出，请与项目源码一起提供给 AI 工具');
 }catch(error){toast('导出失败：'+error.message);}finally{aiExporting=false;refresh();}
}
$('aiReviewExport').onclick=exportAIReview;
$('saveAll').onclick=saveAll;
for(const selector of ['#itemReviewForm .form-footer','#releaseEditForm .form-footer','#subscriptionForm .subscription-footer','#featPanel .panel-foot','#permPanel .panel-foot']){
 const footer=document.querySelector(selector);if(!footer)continue;
 const button=document.createElement('button');button.type='button';button.className='btn save-all-form';button.textContent='保存全部修改';button.onclick=saveAll;footer.append(button);
}
$('mobileSave').textContent='保存全部';$('mobileSave').onclick=saveAll;
window.BoardConfig={documentConfigValues,configValue};
// Keep data transfer/recovery operations in the same menu.
for(const id of ['mExport','mClear']){$(id).classList.add('btn');$('dataTools').append($(id));}
$('btnMore').textContent='帮助与草稿';
const originalUpdate=updateSaveStatus;
updateSaveStatus=function(){originalUpdate();refresh();};
function confirmArchive(snapshot,previous){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='app-dialog archive-decision';
  const form=document.createElement('form');form.innerHTML='<h2>确认发布归档</h2><p>归档保留当前检查结论、变更和遗留问题。存在阻塞时，记录会明确标为未就绪。</p><details><summary>查看发布结论</summary><pre></pre></details><label>确认负责人<input name="owner" required maxlength="200"></label><label>本次发布说明<textarea name="notes" maxlength="4000" placeholder="发布范围、遗留问题安排或回退说明"></textarea></label><label><input name="ack" type="checkbox" required>我已核对当前结论与遗留问题</label><p class="form-error" role="alert"></p><button class="btn" type="button">取消</button><button class="btn primary" type="submit">确认归档</button>';
  form.elements.owner.value=snapshot.release?.owner||'';
  form.querySelector('pre').textContent=ReleaseAnalysis.decisionLines(snapshot,previous).join('\n');
  let result=null;
  form.querySelector('[type=button]').onclick=()=>dialog.close();
  form.onsubmit=event=>{event.preventDefault();const owner=form.elements.owner.value.trim();if(!owner){form.querySelector('[role=alert]').textContent='请填写确认负责人';return;}result={owner,notes:form.elements.notes.value.trim(),confirmedAt:new Date().toISOString()};dialog.close();};
  dialog.append(form);document.body.append(dialog);BoardForms.prepare(dialog);
  dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});dialog.showModal();
 });
}
window.BoardProductivity={saveAll,refresh,categories,confirmArchive};
refresh();
})();
