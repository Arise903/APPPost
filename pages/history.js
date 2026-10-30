/* Shared Pages history viewer. Viewing and exporting never alter a project. */
(function(){
'use strict';
const S=PagesStore;
const date=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false,timeZoneName:'short'}):'未记录';
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
const dialog=node('dialog',undefined,'history-dialog');dialog.id='projectHistoryDialog';dialog.setAttribute('aria-labelledby','historyTitle');
const heading=node('div',undefined,'history-heading'),title=node('h2','历史记录');title.id='historyTitle';const close=node('button','关闭','button secondary btn');close.type='button';close.onclick=()=>dialog.close();heading.append(title,close);
const meta=node('p',undefined,'history-meta');meta.id='historyMeta';
const toolbar=node('div',undefined,'history-tools'),filter=node('select');filter.id='historyFilter';filter.setAttribute('aria-label','筛选历史记录');for(const [value,text] of [['all','全部记录'],['activity','修改记录'],['release','发布归档'],['snapshot','可恢复快照']])filter.add(new Option(text,value));
const search=node('input');search.type='search';search.placeholder='搜索修改内容或版本';search.setAttribute('aria-label','搜索历史记录');toolbar.append(filter,search);
const hint=node('p','保留最近 100 次修改记录、10 份完整快照；发布归档长期保留。更早的操作可能只有快照，没有逐项修改记录。','history-hint');
const body=node('div',undefined,'history-list');body.id='historyList';const error=node('p',undefined,'history-error');error.setAttribute('role','alert');dialog.append(heading,meta,toolbar,hint,error,body);document.body.append(dialog);
let projectId=null;
function pending(){return (window.ReleaseExperience?.pending?.()||false)||(typeof subscriptionDialog!=='undefined'&&subscriptionHasChanges());}
function preview(snapshot){
 const container=node('div',undefined,'history-preview');
 const project=snapshot.document?snapshot:null,parsed=project?S.payload({...project,version:1,generation:1,permissions:project.permissions||{selected:[],descs:{},descsEn:{}},review:project.review||{release:{},items:{},history:[]}}):null;
 const items=parsed?parsed.items.filter(i=>!i.gate&&parsed.features[i.cond]!==false&&window.PermissionVisibility.visible(i.permissionRule,project.permissions.selected,PAGES_DATA.profiles)&&window.PermissionVisibility.platformVisible(i,project.review.release.platform)):(snapshot.items||[]).filter(i=>i.applicable!==false);
 const release=project?project.review.release:snapshot.release;
 container.append(node('p','版本：'+(release?.version||'未填写')+' · 完成 '+items.filter(i=>i.state==='done').length+' / '+items.length+' 项 · 跳过 '+items.filter(i=>i.state==='skip').length+' 项'));
 const readiness=snapshot.readiness||(project?S.readiness(project):ReleaseReadiness.assess(snapshot));container.append(node('p',(readiness.ready?'发布就绪':'发布未就绪')+' · 阻塞 '+readiness.blockers+' 项 · 缺少必需证据 '+readiness.missingEvidence+' 项'));
 const details=node('details'),summary=node('summary','查看当时的检查结果、备注和配置');details.append(summary);
 const list=node('ul');for(const item of items){const li=node('li',({done:'✓ ',skip:'— ',todo:'○ '}[item.state]||'○ ')+item.text);const note=project?project.review.items?.[item.id]:item;for(const [key,label] of [['reason','跳过原因'],['notes','备注'],['evidence','证据']])if(note?.[key])li.append(node('p',label+'：'+note[key]));list.append(li);}details.append(list);
 const config=node('details');config.append(node('summary','查看项目、订阅商品和权限配置'));const pre=node('pre',JSON.stringify({release,features:project?parsed.features:snapshot.features,subscriptions:project?project.review.subscriptions||[]:snapshot.subscriptions||[],permissions:project?project.permissions:snapshot.permissions||snapshot.selectedPermissions||[]},null,2));config.append(pre);details.append(config);container.append(details);return container;
}
function render(){
 const p=S.get(projectId);title.textContent=p.name+' · 历史记录';meta.textContent='创建于 '+date(p.createdAt)+'　｜　最近修改 '+date(p.updatedAt);error.textContent='';body.replaceChildren();
 const events=[...(p.activity||[]).map(a=>({...a,type:'activity'})),...(p.review.history||[]).map((value,index)=>({type:'release',date:Date.parse(value.date)||0,label:'发布归档 · '+(value.release?.version||value.version||'未填写版本'),value,index})),...(p.snapshots||[]).map(value=>({type:'snapshot',date:value.date,label:'操作前快照 · '+value.label,value}))].sort((a,b)=>b.date-a.date);
 const shown=events.filter(event=>(filter.value==='all'||event.type===filter.value)&&(!search.value||JSON.stringify([event.label,event.changes,event.value?.release]).toLowerCase().includes(search.value.toLowerCase())));
 for(const event of shown){
  const card=node('article',undefined,'history-event');card.dataset.type=event.type;card.append(node('time',date(event.date)),node('h3',event.label));
  if(event.type==='activity'){const list=node('ul');for(const change of event.changes||[])list.append(node('li',change));card.append(list);}
  else{
   if(event.type==='snapshot')card.append(node('p','此快照保存于上方操作发生前；内容最后修改于 '+date(event.value.state.updatedAt),'history-hint'));
   const details=node('details');details.append(node('summary','查看记录'));details.addEventListener('toggle',()=>{if(details.open&&!details.dataset.loaded){details.dataset.loaded='1';try{details.append(preview(event.type==='snapshot'?event.value.state:event.value));}catch(e){details.append(node('p','无法预览：'+e.message));}}});card.append(details);
   const actions=node('div',undefined,'history-tools'),download=node('button','下载这份记录','button secondary btn');download.type='button';download.onclick=()=>S.download('release-history-'+(event.date||'legacy')+'.json',JSON.stringify(event.type==='snapshot'?{format:'release-desk/v1',...event.value.state}:event.value,null,2));actions.append(download);
   if(event.type==='snapshot'){const restore=node('button','恢复此快照','button secondary btn');restore.type='button';restore.onclick=async()=>{
    try{if(pending())throw Error('当前有未保存内容，请先保存或取消修改，再恢复历史快照。');if(!confirm('恢复此快照？当前项目会先保留快照，随后恢复检查、配置和备注。'))return;restore.disabled=true;
     await S.mutate(projectId,p.version,'restore',current=>{const selected=current.snapshots.find(s=>s.id===event.value.id);if(!selected)throw Error('快照已变化，请重新打开历史记录');const version=current.version,generation=current.generation;Object.assign(current,JSON.parse(JSON.stringify(selected.state)));current.version=version;current.generation=Math.max(generation,current.generation)+1;});
     if(window.RELEASE_PAGES){location.reload();return;}window.dispatchEvent(new Event('storage'));render();
    }catch(e){error.textContent=e.message;}finally{restore.disabled=false;}
   };actions.append(restore);}card.append(actions);
  }
  body.append(card);
 }
 if(!shown.length)body.append(node('p','暂无匹配的记录。完成一次保存后，这里会显示修改内容和时间。','history-empty'));
}
function open(id){try{projectId=id;filter.value='all';search.value='';render();window.BoardForms?.prepare(dialog);dialog.showModal();}catch(e){alert(e.message);}}
filter.onchange=render;search.oninput=render;
window.ReleaseHistory={open};
if(window.RELEASE_PAGES){
 const history=node('button','历史记录','btn');history.id='btnHistory';history.type='button';history.onclick=()=>open(S.projectId());(document.getElementById('historyMenuActions')||document.getElementById('btnSave').parentElement).append(history);
 const recovery=document.getElementById('backupRestore');recovery.textContent='备份与恢复';recovery.onclick=()=>{open(S.projectId());filter.value='snapshot';render();};
 const status=node('div',undefined,'history-last-modified');status.id='projectModifiedAt';document.getElementById('saveStatus').after(status);
 const update=()=>{try{status.textContent='最近修改：'+date(S.get(S.projectId()).updatedAt)+' · 历史记录可查看修改内容、版本和快照';}catch(_){}};update();window.addEventListener('projectchanged',update);window.addEventListener('storage',update);
}
})();
