/* Retry, inspect conflicts and recover explicitly saved form drafts. */
const FORM_DRAFT_KEY=LS_KEY+':forms';
let failedWrite=null;
function captureFormDraft(){
 const result={format:'release-desk-form-draft/v1',date:new Date().toISOString(),revision:baseRevision,generation:gen,checks:{...state}};
 if(itemReviewDirty())result.item={id:document.getElementById('itemReviewDialog').dataset.id,values:itemReviewValues()};
 if(releaseEditorDirty())result.release=releaseEditorValues();
 if(subscriptionDialog.open&&JSON.stringify(subscriptionRead())!==subscriptionBaseline)result.subscriptions=subscriptionRead();
 if(featureHasChanges())result.features=currentFeatures();
 if(permDirty)result.permissions={selected:permSelected,descs:permDescs,descsEn:permDescsEn};
 return result;
}
function persistFormDraft(){try{const draft=captureFormDraft();if(draft.item||draft.release||draft.subscriptions||draft.features||draft.permissions)localStorage.setItem(FORM_DRAFT_KEY,JSON.stringify(draft));else localStorage.removeItem(FORM_DRAFT_KEY);}catch(_){/* Export remains available when local storage is unavailable. */}}
function exportCurrentDraft(){const url=URL.createObjectURL(new Blob([JSON.stringify(captureFormDraft(),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='release-form-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function showFormSaveFailure(container,form,message){container.textContent=message;const retry=document.createElement('button');retry.type='button';retry.className='btn';retry.textContent='重试保存';retry.onclick=()=>form.requestSubmit();container.append(retry);}
function clearFailedWrite(path){if(failedWrite?.path===path){failedWrite=null;const button=document.getElementById('retryFailedSave');if(button)button.hidden=true;}}
function rememberFailedWrite(path,body,error){failedWrite={path,body,message:error.message};persistFormDraft();const retry=document.getElementById('retryFailedSave');if(retry)retry.hidden=false;}
async function retryFailedWrite(){
 if(!failedWrite){toast('暂无失败的保存');return;}
 if(failedWrite.path==='/api/review'){for(const id of ['itemReviewDialog','releaseEditDialog','subscriptionDialog']){const dialog=document.getElementById(id);if(dialog.open){dialog.querySelector('form').requestSubmit();return;}}}
 if(failedWrite.path==='/api/write'){document.getElementById('btnSave').click();return;}
 if(failedWrite.path==='/api/features'){document.getElementById('featSave').click();return;}
 if(failedWrite.path==='/api/perm-write'){document.getElementById('permSave').click();return;}
 toast('请在原操作面板中重试；草稿可以导出保留。');
}
async function conflictPreview(){
 const dialog=document.createElement('dialog');dialog.className='workflow-dialog';dialog.setAttribute('aria-label','冲突差异');const title=document.createElement('h2');title.textContent='当前草稿与最新保存记录的差异';const pre=document.createElement('pre');pre.className='conflict-preview';dialog.append(title,pre);
 const close=document.createElement('button');close.className='btn';close.textContent='关闭';close.onclick=()=>dialog.close();dialog.append(close);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
 try{let latest;if(window.RELEASE_PAGES){await PagesStore.refreshStorage();latest=PagesStore.snapshot(PagesStore.get(PagesStore.projectId()));}else{const response=await boardFetch('/api/list');if(!response.ok)throw Error('无法读取最新项目');const d=await response.json();latest={release:d.review.release,subscriptions:d.review.subscriptions||[],features:d.features,selectedPermissions:d.permSelected,permissions:{selected:d.permSelected,descs:d.permDescs,descsEn:d.permDescsEn},items:d.items.map(i=>({...d.review.items[i.id],...i,applicable:!i.gate&&d.features[i.cond]!==false&&PermissionVisibility.visible(i.permissionRule,d.permSelected,EMBEDDED_PROFILES)&&PermissionVisibility.platformVisible(i,d.review.release?.platform)}))};}const local=releaseSnapshot();if(releaseEditorDirty())local.release=releaseEditorValues();if(itemReviewDirty()){const id=document.getElementById('itemReviewDialog').dataset.id;local.items=local.items.map(i=>i.id===id?{...i,...itemReviewValues()}:i);}const diff=ReleaseAnalysis.compare(local,latest);pre.textContent=diff.changes.length?diff.changes.map(c=>c.area+' · '+c.id+'\n本页草稿：'+JSON.stringify(c.before)+'\n最新保存：'+JSON.stringify(c.after)).join('\n\n'):'当前记录一致。';}catch(error){pre.textContent=error.message;}
}
async function restoreFormDraft(value){
 let draft=value;if(!draft){const raw=localStorage.getItem(FORM_DRAFT_KEY);if(!raw){toast('没有可恢复的表单草稿');return;}draft=JSON.parse(raw);}
 if(draft.format!=='release-desk-form-draft/v1')throw Error('请选择表单草稿 JSON');
 if((draft.generation!==gen||String(draft.revision)!==String(baseRevision))&&!confirm('此草稿来自另一批次或旧版本，恢复前请结合冲突差异核对，避免覆盖更新内容。继续？'))return;
 if(draft.item){const item=[...(DATA.preamble||[]),...DATA.sections.flatMap(s=>s.blocks)].find(i=>i.id===draft.item.id);if(!item)throw Error('草稿对应的检查项已删除，请保留导出文件');openItemReview(item);for(const [key,value] of Object.entries(draft.item.values)){const input=document.getElementById('itemReviewForm').elements[key];if(input){if(input.type==='checkbox')input.checked=value==='on';else input.value=value;}}}
 else if(draft.release){openReleaseEditor();for(const [key,value] of Object.entries(draft.release)){const input=document.getElementById('releaseEditForm').elements[key];if(input)input.value=value;}}
 else if(draft.subscriptions){document.getElementById('btnSubscriptions').click();subscriptionDraft=draft.subscriptions;subscriptionRender();subscriptionUpdateStatus();}
 else if(draft.features){openFeatPanel();for(const [key,id] of [['hasAccountSystem','featAcc'],['targetMinors','featMinor'],['hasSubscriptions','featSubscription'],['hasPush','featPush'],['hasFeedbackSystem','featFeedback']])document.getElementById(id).checked=!!draft.features[key];onFeatToggle();}
 else if(draft.permissions){await openPermPanel();permSelected=draft.permissions.selected;permDescs=draft.permissions.descs;permDescsEn=draft.permissions.descsEn;permDirty=true;renderPerms();refreshPermGen();}
 else toast('文件中只有检查进度；检查进度草稿会在看板正常恢复。');
 updateSaveStatus();
}
function installSaveRecovery(){
 const row=document.createElement('div');row.className='save-recovery';for(const [id,label,action] of [['retryFailedSave','重试失败保存',retryFailedWrite],['exportFormDraft','导出当前草稿',exportCurrentDraft],['restoreFormDraft','恢复表单草稿',()=>restoreFormDraft()],['viewConflict','查看冲突差异',conflictPreview]]){const button=document.createElement('button');button.type='button';button.className='btn';button.id=id;button.textContent=label;button.onclick=()=>Promise.resolve().then(action).catch(error=>toast(error.message));if(id==='retryFailedSave')button.hidden=true;row.append(button);}
 const label=document.createElement('label');label.className='btn';label.textContent='导入表单草稿';const input=document.createElement('input');input.type='file';input.accept='.json';input.hidden=true;input.onchange=async()=>{const file=input.files[0];if(!file)return;try{if(file.size>1500000)throw Error('草稿文件请小于 1.5 MB');await restoreFormDraft(JSON.parse(await file.text()));}catch(error){toast(error.message);}finally{input.value='';}};label.append(input);row.append(label);document.getElementById('saveStatus').after(row);
 let timer;document.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(persistFormDraft,250);});window.addEventListener('beforeunload',persistFormDraft);
 for(const id of ['itemReviewDialog','releaseEditDialog','subscriptionDialog'])document.getElementById(id).addEventListener('close',persistFormDraft);
 if(localStorage.getItem(FORM_DRAFT_KEY))toast('发现未保存的表单草稿，可点击「恢复表单草稿」继续。');
}
installSaveRecovery();
