/* Compact commands, common forms and project-scoped reading preferences. */
(function(){
'use strict';
const $=id=>document.getElementById(id),key=LS_KEY+':view';
let preferences={view:'all',filter:'all',section:'all',query:'',collapsed:{},anchor:null,generation:gen},restored=false,scrollTimer,saveTimer;
try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&saved.generation===gen)preferences={...preferences,...saved};}catch(_){}
function remember(){try{localStorage.setItem(key,JSON.stringify({...preferences,generation:gen}));}catch(_){} }
function returnFocus(opener){if(!opener?.isConnected)return;const menu=opener.closest('details.board-menu');const target=menu&&!menu.open?menu.querySelector('summary'):opener;requestAnimationFrame(()=>target?.focus({preventScroll:true}));}
function formValues(form){return JSON.stringify([...form.elements].filter(el=>!['submit','button'].includes(el.type)).map(el=>[el.name||el.id,el.type==='checkbox'?el.checked:el.type==='file'?el.files.length:el.value]));}
function prepareForm(dialog){
 if(dialog.dataset.formPrepared)return;dialog.dataset.formPrepared='true';dialog.classList.add('app-dialog');const form=dialog.querySelector(':scope > form');
 if(form&&!dialog.classList.contains('item-drawer')){
  let heading=form.querySelector(':scope > .form-heading,:scope > .dialog-heading,:scope > .subscription-head');
  if(!heading){heading=document.createElement('header');heading.className='form-heading';const title=form.querySelector('h2');if(title)heading.append(title);form.prepend(heading);}heading.classList.add('form-heading');
  let footer=form.querySelector(':scope > .form-footer,:scope > .subscription-footer');if(!footer){footer=document.createElement('footer');footer.className='form-footer';form.append(footer);}footer.classList.add('form-footer');
  for(const child of [...form.children])if(child.tagName==='BUTTON'||child.matches('[role="alert"],.form-error'))footer.append(child);
  let body=form.querySelector(':scope > .form-body');if(!body){body=document.createElement('div');body.className='form-body';for(const child of [...form.children])if(child!==heading&&child!==footer)body.append(child);heading.after(body);}
  if(!heading.querySelector('button')){const close=document.createElement('button');close.type='button';close.className='btn';close.textContent='关闭';close.setAttribute('aria-label','关闭'+(heading.querySelector('h2')?.textContent||'表单'));close.onclick=()=>{const cancel=footer.querySelector('button[type="button"]');if(cancel)cancel.click();else if(dialog.dataset.saving!=='true'&&(!dialog.dataset.formBaseline||dialog.dataset.formBaseline===formValues(form)||confirm('放弃尚未保存的修改？')))dialog.close();};heading.append(close);}
 }
 const show=dialog.showModal.bind(dialog);dialog.showModal=function(){dialog._returnFocus=document.activeElement;if(form)dialog.dataset.formBaseline=formValues(form);show();};
 dialog.addEventListener('close',()=>returnFocus(dialog._returnFocus));
 if(dialog.id==='newReleaseDialog'){dialog.addEventListener('cancel',event=>{if(dialog.dataset.formBaseline!==formValues(form)&&!confirm('放弃尚未保存的新发布信息？'))event.preventDefault();});$('cancelNewRelease').onclick=()=>{if(dialog.dataset.formBaseline===formValues(form)||confirm('放弃尚未保存的新发布信息？'))dialog.close();};}
}
window.BoardForms={prepare:prepareForm,returnFocus};document.querySelectorAll('dialog').forEach(prepareForm);
function updateHeader(){
 const release=reviewData.release||{};$('boardReleaseLabel').textContent=[release.app,release.version?'版本 '+release.version:'尚未填写版本',release.build?'构建 '+release.build:''].filter(Boolean).join(' · ');
 window.BoardRecovery?.refresh();
}
function setExpanded(section,expanded){const body=section.querySelector(':scope > .section-content'),button=section.querySelector('.chapter-collapse');if(!body)return;body.hidden=!expanded;button?.setAttribute('aria-expanded',String(expanded));if(button)button.textContent=expanded?'收起':'展开';preferences.collapsed[section.dataset.sec]=!expanded;remember();}
function reveal(row){if(!row)return;const section=row.closest('section.card');if(section?.querySelector('.section-content'))setExpanded(section,true);}
function afterBuild(){
 for(const section of document.querySelectorAll('#list > section.card[data-sec]')){
  if(section.querySelector(':scope > .section-content'))continue;const heading=section.querySelector(':scope > h2');if(!heading)continue;
  const body=document.createElement('div');body.className='section-content';while(heading.nextSibling)body.append(heading.nextSibling);section.append(body);const toggle=document.createElement('button');toggle.type='button';toggle.className='chapter-collapse';toggle.setAttribute('aria-label','展开或收起'+heading.textContent);toggle.onclick=()=>setExpanded(section,body.hidden);heading.append(toggle);setExpanded(section,!preferences.collapsed[section.dataset.sec]);
 }
 const nav=$('chapterLinks');nav.replaceChildren();for(const section of DATA.sections.filter(s=>!s.guide_only&&s.blocks.some(b=>b.type==='item'&&!b.gate&&b.visible!==false))){const button=document.createElement('button');button.type='button';button.textContent=section.title;button.dataset.chapter=section.id;button.onclick=()=>{sectionFilter=section.id;$('sectionFilter').value=section.id;preferences.section=section.id;applyFilter();const target=[...document.querySelectorAll('#list section.card')].find(el=>el.dataset.sec===section.id);if(target){setExpanded(target,true);target.scrollIntoView({behavior:'smooth',block:'start'});}remember();};nav.append(button);}
 updateHeader();scheduleRestore();
}
function filterRows(){
 const mode=$('viewMode').value,issues=ReleaseReadiness.assess(releaseSnapshot()).issues,issueIds=new Set(issues.map(i=>i.id)),special=new Set(issues.filter(i=>i.reason!=='必需项待检查').map(i=>i.id));
 for(const row of document.querySelectorAll('#list li.item')){
  if(row.classList.contains('hidden'))continue;const id=row.dataset.id;
  if(row.dataset.gate==='1'){if(mode!=='all'&&st(id)==='done')row.classList.add('hidden');continue;}
  const status=row.querySelector('.item-status');if(status){const issue=issues.find(i=>i.id===id&&i.reason!=='必需项待检查');status.textContent=issue?'需处理':row.classList.contains('current')?'当前项':({done:'已完成',skip:'已跳过',todo:'待检查'}[st(id)]||'待检查');status.dataset.state=issue?'issue':st(id);status.title=issue?.reason||'';}
  const show=mode==='all'||mode==='blockers'&&issueIds.has(id)||mode==='focus'&&(row.classList.contains('current')||special.has(id)||row.dataset.locked==='0'&&st(id)==='todo');if(!show)row.classList.add('hidden');
 }
 for(const section of document.querySelectorAll('#list > section.card'))if(section.querySelector('li.item'))section.classList.toggle('hidden',!section.querySelector('li.item:not(.hidden)'));
 $('empty').classList.toggle('hidden',!!document.querySelector('#list li.item:not(.hidden)'));
 document.querySelector('.board-content').dataset.view=mode;
 document.querySelectorAll('#chapterLinks button').forEach(button=>button.setAttribute('aria-current',String(button.dataset.chapter===sectionFilter)));
 updateHeader();
}
function saveFilters(){preferences.view=$('viewMode').value;preferences.filter=filter;preferences.section=sectionFilter;preferences.query=$('q').value;clearTimeout(saveTimer);saveTimer=setTimeout(remember,180);}
function capturePosition(){if(!restored||document.querySelector('dialog[open]'))return;const rows=[...document.querySelectorAll('#list li.item:not(.hidden)')].filter(el=>el.getBoundingClientRect().height>0),target=rows.find(el=>el.getBoundingClientRect().bottom>120);if(target)preferences.anchor={id:target.dataset.id,offset:target.getBoundingClientRect().top};remember();}
function scheduleRestore(){if(restored)return;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(restored)return;restored=true;const anchor=preferences.anchor,row=anchor&&[...document.querySelectorAll('#list li.item')].find(el=>el.dataset.id===anchor.id);if(row&&!row.classList.contains('hidden')){reveal(row);window.scrollBy(0,row.getBoundingClientRect().top-anchor.offset);}}));}
function loaded(){scheduleRestore();updateHeader();}
window.BoardWorkspace={afterBuild,filterRows,reveal,loaded,updateHeader};
filter=['all','todo','done','skip'].includes(preferences.filter)?preferences.filter:'all';query=preferences.query||'';sectionFilter=preferences.section||'all';$('q').value=query;$('viewMode').value=['all','focus','blockers'].includes(preferences.view)?preferences.view:'all';refreshSectionFilter();
$('seg').querySelectorAll('button').forEach(button=>{const active=button.dataset.f===filter;button.classList.toggle('on',active);button.setAttribute('aria-pressed',String(active));});
$('continueCheck').onclick=jumpToCurrent;$('viewMode').onchange=()=>{applyFilter();saveFilters();if($('viewMode').value==='focus')jumpToCurrent();};
for(const name of ['input','change','click'])document.querySelector('.check-toolbar').addEventListener(name,()=>setTimeout(saveFilters,140));
window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(capturePosition,180);},{passive:true});window.addEventListener('beforeunload',()=>{saveFilters();remember();capturePosition();});
const menus=[...document.querySelectorAll('.board-menu')];for(const menu of menus)menu.addEventListener('toggle',()=>{if(menu.open)menus.filter(other=>other!==menu).forEach(other=>other.open=false);});
document.addEventListener('click',event=>{const menu=event.target.closest('.board-menu');if(!menu)menus.forEach(el=>el.open=false);else if(event.target.closest('button'))menu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape')menus.forEach(menu=>menu.open=false);});
afterBuild();applyFilter();
})();
