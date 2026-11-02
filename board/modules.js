/* Optional SDK checklists share stable task identities across templates and editions. */
const OPTIONAL_MODULES=__OPTIONAL_MODULES__;

/* Only report real differences from the saved baseline. Items missing from
   `state` mean "todo", never "changed": treating undefined as a change made every
   untouched row part of the save request and failed the post-save verification. */
function stateDiff(state, baseline){
 const out={};
 for(const id of new Set([...Object.keys(baseline), ...Object.keys(state)])){
  const value=state[id]||"todo";
  if(value!==(baseline[id]||"todo")) out[id]=value;
 }
 return out;
}
function ensureFeatureModules(){
 DATA.features.hasInitialization=!!(DATA.features.hasAdjust||DATA.features.hasAnalysisApi);
 const ids=new Set((DATA.sections||[]).flatMap(s=>s.blocks||[]).filter(b=>b.type==='item').map(b=>b.id));
 for(const module of OPTIONAL_MODULES){
  if(DATA.features[module.feature]===undefined)DATA.features[module.feature]=[module.legacyTaskId,...module.items.map(item=>item[0])].some(id=>ids.has(id));
  if(!DATA.features[module.feature]||[module.legacyTaskId,...module.items.map(item=>item[0])].some(id=>ids.has(id)))continue;
  // 导入或旧模板的清单可能已用自己的条目实现了同一模块；有同名章节就不再重复注入，
  // 否则同一节会出现两次，改动会落在文件里根本不存在的那一份上。
  if((DATA.sections||[]).some(section=>section.id==='module_'+module.id||String(section.title||'').trim()===module.title))continue;
  DATA.sections.push({id:'module_'+module.id,title:module.title,blocks:module.items.map(([id,text,condition])=>({type:'item',id,text,level:0,state:st(id),checked:st(id)==='done',cond:condition||module.feature}))});
 }
}

/* Newly enabled initialization checks must not remain hidden by an old view. */
function revealInitializationChecks(){
 if(!DATA?.features?.hasInitialization)return;
 filter='all';query='';sectionFilter='all';
 document.getElementById('q').value='';document.getElementById('sectionFilter').value='all';document.getElementById('viewMode').value='all';
 document.querySelectorAll('#seg button').forEach(button=>{const active=button.dataset.f==='all';button.classList.toggle('on',active);button.setAttribute('aria-pressed',String(active));});
 applyFilter();
 const section=DATA.sections.find(s=>s.title.includes('初始化流程核对'));
 const element=section&&[...document.querySelectorAll('#list section.card')].find(el=>el.dataset.sec===section.id);
 window.BoardWorkspace?.reveal(element?.querySelector('li.item'));
}
