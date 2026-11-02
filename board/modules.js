/* Optional SDK checklists share stable task identities across templates and editions. */
const OPTIONAL_MODULES=__OPTIONAL_MODULES__;
function ensureFeatureModules(){
 DATA.features.hasInitialization=!!(DATA.features.hasAdjust||DATA.features.hasAnalysisApi);
 const ids=new Set((DATA.sections||[]).flatMap(s=>s.blocks||[]).filter(b=>b.type==='item').map(b=>b.id));
 for(const module of OPTIONAL_MODULES){
  if(DATA.features[module.feature]===undefined)DATA.features[module.feature]=[module.legacyTaskId,...module.items.map(item=>item[0])].some(id=>ids.has(id));
  if(!DATA.features[module.feature]||[module.legacyTaskId,...module.items.map(item=>item[0])].some(id=>ids.has(id)))continue;
  DATA.sections.push({id:'module_'+module.id,title:module.title,blocks:module.items.map(([id,text])=>({type:'item',id,text,level:0,state:st(id),checked:st(id)==='done',cond:module.feature}))});
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
