/* Shared permission-driven checklist visibility; keeps task IDs and saved states intact. */
(function(root){
 const api={
  annotate(sections,rules){
   for(const section of sections||[]){
    let group=null,feature=null;
    for(const block of section.blocks||[]){
     if(block.type==='h3'||block.type==='h4'){
      group=(rules.groups||[]).find(g=>new RegExp(g.heading).test(block.title))||null;
      feature=(rules.featureGroups||[]).find(g=>new RegExp(g.heading).test(block.title))?.feature||null;
     }
     if(block.type!=='item')continue;
     const knownFeature=rules.featureConditions?.[block.id]||feature||(rules.featureText||[]).find(r=>block.text.includes(r.contains))?.feature;
     if(knownFeature)block.cond=knownFeature;
     const requirement=rules.itemRules?.[block.id]||(group?(group.rules.find(r=>block.text.includes(r.contains))?.requires||group.default):null);
     if(requirement)block.permissionRule=requirement;
    }
   }
  },
  visible(rule,selected,profiles){
   if(!rule)return true;const ids=new Set(selected||[]);if(Array.isArray(rule))return rule.some(id=>ids.has(id));
   const picked=(profiles.permissions||[]).filter(p=>ids.has(p.id));
   if(rule==='any')return picked.length>0;
   if(rule==='ios')return picked.some(p=>p.id==='notifications'||p.ios?.infoplist_key||p.ios?.infoplist_keys?.length);
   if(rule==='prompt')return picked.some(p=>p.id==='notifications'||p.ios?.infoplist_key||p.ios?.infoplist_keys?.length||p.android?.runtime);
   if(rule==='iosUsage')return picked.some(p=>p.ios?.infoplist_key||p.ios?.infoplist_keys?.length);
   if(rule==='android')return picked.some(p=>p.android?.manifest);
   if(rule==='androidRuntime')return picked.some(p=>p.android?.manifest&&p.android?.runtime);
   return false;
  }
 };root.PermissionVisibility=api;
})(typeof window==='undefined'?globalThis:window);
