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
