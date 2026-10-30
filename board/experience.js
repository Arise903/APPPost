/* Shared board policies and explicit form drafts. */
function boardPendingDetails(){
 const pending=[];
 if(typeof dirty!=='undefined'&&dirty)pending.push('检查进度');
 if(typeof permDirty!=='undefined'&&permDirty)pending.push('权限配置');
 if(typeof featureSnapshot!=='undefined'&&featureHasChanges())pending.push('项目设置');
 const subscriptions=document.getElementById('subscriptionDialog');
 if(subscriptions?.open&&typeof subscriptionBaseline!=='undefined'&&JSON.stringify(subscriptionRead())!==subscriptionBaseline)pending.push('订阅商品');
 if(releaseEditorDirty())pending.push('发布信息');
 if(itemReviewDirty())pending.push('备注与检查要求');
 return pending;
}
function itemReviewDirty(){const dialog=document.getElementById('itemReviewDialog');return !!dialog?.open&&(dialog.dataset.baseline!==JSON.stringify(itemReviewValues())||document.getElementById('itemAttachmentUpload').files.length>0);}
function itemReviewValues(){const f=document.getElementById('itemReviewForm');return {attachmentIds:f.elements.attachmentIds.value,...Object.fromEntries(['evidenceExpiresAt','exceptionType','exceptionOwner','reviewDue','reviewStatus','reviewedAt','approvalStatus','approvalBy','approvalDate'].map(k=>[k,f.elements[k].value])),reason:f.elements.reason.value,notes:f.elements.notes.value,evidence:f.elements.evidence.value,required:f.elements.required.checked?'on':'off',evidenceRequired:f.elements.evidenceRequired.checked?'on':'off'};}
function openItemReview(item){
 if(!online){toast('请先连接存储服务');return;}
 const dialog=document.getElementById('itemReviewDialog'),form=document.getElementById('itemReviewForm'),old=reviewData.items?.[item.id]||{};
 dialog.dataset.id=item.id;document.getElementById('itemReviewText').textContent=item.text;
 for(const key of ['reason','notes','evidence','evidenceExpiresAt','exceptionOwner','reviewDue','reviewedAt','approvalBy','approvalDate'])form.elements[key].value=old[key]||'';for(const [key,fallback] of [['exceptionType','legacy'],['reviewStatus','pending'],['approvalStatus','pending']])form.elements[key].value=old[key]||fallback;
 form.elements.attachmentIds.value=old.attachmentIds||'[]';document.getElementById('itemAttachmentUpload').value='';document.getElementById('itemReviewMeta').textContent=({done:'已完成',skip:'已跳过',todo:'待检查'}[st(item.id)]||'待检查')+' · '+(old.required==='off'?'可选检查':'发布必需项');document.getElementById('itemEvidenceSection').open=!!old.evidence||old.evidenceRequired==='on'||detailAttachmentIds().length>0;renderItemAttachments();
 form.elements.required.checked=old.required!=='off';form.elements.evidenceRequired.checked=old.evidenceRequired==='on';
 dialog.dataset.baseline=JSON.stringify(itemReviewValues());document.getElementById('itemReviewError').textContent='';dialog.showModal();
}
function closeItemReview(){if(document.getElementById('itemReviewDialog').dataset.saving==='true')return;if(itemReviewDirty()&&!confirm('放弃尚未保存的备注与检查要求？'))return;document.getElementById('itemReviewDialog').close();updateSaveStatus();}
function refreshReadiness(){
 const summary=document.getElementById('readinessSummary');if(!summary||!DATA)return;
 const result=ReleaseReadiness.assess(releaseSnapshot());
 summary.textContent=(result.ready?'发布就绪':'发布未就绪')+' · 完成 '+result.done+' / 跳过 '+result.skipped+' / 待检 '+result.pending+' · 阻塞 '+result.blockers+' · 缺少证据 '+result.missingEvidence;
 summary.parentElement.dataset.ready=String(result.ready);
 const list=document.getElementById('readinessIssues'),signature=JSON.stringify(result);if(list.dataset.signature===signature)return;list.dataset.signature=signature;list.replaceChildren();
 for(const issue of result.issues){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='btn';button.textContent=issue.reason+' · '+issue.text;button.onclick=()=>{if(issue.id==='__release'){openReleaseEditor();return;}if(issue.id==='__subscriptions'){document.getElementById('btnSubscriptions').click();return;}if(issue.id==='__preflight'){window.ReleaseWorkflows?.preflight();return;}sectionFilter='all';filter='all';query='';document.getElementById('q').value='';document.getElementById('sectionFilter').value='all';document.querySelectorAll('#seg button').forEach(b=>{b.classList.toggle('on',b.dataset.f==='all');b.setAttribute('aria-pressed',String(b.dataset.f==='all'));});applyFilter();const row=[...document.querySelectorAll('li.item')].find(el=>el.dataset.id===issue.id);window.BoardWorkspace?.reveal(row);row?.scrollIntoView({block:'center',behavior:'smooth'});row?.querySelector('.txt')?.animate([{background:'#ffe9b0'},{background:'transparent'}],{duration:1600});};li.append(button);list.append(li);}
}
function installBoardExperience(){
 const dialog=document.getElementById('itemReviewDialog'),form=document.getElementById('itemReviewForm');
 document.getElementById('itemReviewCancel').onclick=closeItemReview;document.getElementById('itemReviewClose').onclick=closeItemReview;
 dialog.addEventListener('cancel',event=>{event.preventDefault();closeItemReview();});form.addEventListener('input',updateSaveStatus);
 form.onsubmit=async event=>{event.preventDefault();const controls=[...form.elements];controls.forEach(el=>el.disabled=true);dialog.dataset.saving='true';try{const next=JSON.parse(JSON.stringify(reviewData));next.items=next.items||{};next.items[dialog.dataset.id]={...next.items[dialog.dataset.id],...itemReviewValues()};const itemId=dialog.dataset.id;const attachments=await prepareItemAttachments(next,itemId);for(const file of Object.values(next.evidenceFiles||{})){if(file.taskIds?.includes(itemId)&&!JSON.parse(next.items[itemId].attachmentIds||'[]').includes(file.id))file.taskIds=file.taskIds.filter(id=>id!==itemId);}if(await persistReview(next,Object.keys(attachments).length?{assets:attachments}:{})){dialog.close();updateSaveStatus();}else showFormSaveFailure(document.getElementById('itemReviewError'),form,'保存失败，草稿已保留。');}catch(error){showFormSaveFailure(document.getElementById('itemReviewError'),form,error.message);}finally{dialog.dataset.saving='false';controls.forEach(el=>el.disabled=false);}};
 document.addEventListener('click',event=>{const a=event.target.closest('a[href]');if(a&&a.target!=='_blank'&&boardPendingDetails().length&&!confirm('还有未保存的'+boardPendingDetails().join('、')+'，离开当前页面？'))event.preventDefault();});
 installReleaseEditor();refreshReadiness();
}

function releaseEditorValues(){const form=document.getElementById('releaseEditForm');return Object.fromEntries(['app','platform','version','build','date','owner','appIdIOS','appIdAndroid','environment','apiBaseUrl','targetDate','status','strictValidation','timeZone'].map(k=>[k,form.elements[k].value.trim()]));}
function releaseEditorDirty(){const dialog=document.getElementById('releaseEditDialog');return !!dialog?.open&&dialog.dataset.baseline!==JSON.stringify(releaseEditorValues());}
function openReleaseEditor(){if(!online){toast('请先连接存储服务');return;}const form=document.getElementById('releaseEditForm'),release=reviewData.release||{};for(const key of ['app','platform','version','build','date','owner','appIdIOS','appIdAndroid','environment','apiBaseUrl','targetDate','status','strictValidation','timeZone']){const input=form.elements[key],value=release[key]||(key==='date'?ReleaseReadiness.calendarDate(undefined,release.timeZone):key==='timeZone'?ReleaseReadiness.DEFAULT_TIME_ZONE:key==='environment'?'production':key==='status'?'planning':key==='strictValidation'?'off':'');if(input.tagName==='SELECT'&&value&&![...input.options].some(o=>o.value===value))input.add(new Option(value,value));input.value=value;}const dialog=document.getElementById('releaseEditDialog');dialog.dataset.baseline=JSON.stringify(releaseEditorValues());document.getElementById('releaseEditError').textContent='';dialog.showModal();}
function installReleaseEditor(){const dialog=document.getElementById('releaseEditDialog'),form=document.getElementById('releaseEditForm');function close(){if(dialog.dataset.saving==='true')return;if(releaseEditorDirty()&&!confirm('放弃尚未保存的发布信息？'))return;dialog.close();updateSaveStatus();}document.getElementById('releaseEditCancel').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});form.addEventListener('input',updateSaveStatus);form.onsubmit=async event=>{event.preventDefault();const next=JSON.parse(JSON.stringify(reviewData));next.release={...next.release,...releaseEditorValues()};const controls=[...form.elements];controls.forEach(el=>el.disabled=true);dialog.dataset.saving='true';try{if(await persistReview(next)){dialog.close();updateSaveStatus();}else showFormSaveFailure(document.getElementById('releaseEditError'),form,'保存失败，发布信息草稿已保留。');}finally{dialog.dataset.saving='false';controls.forEach(el=>el.disabled=false);}};}
