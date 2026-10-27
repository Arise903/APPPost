/* Shared permission-driven checklist visibility; keeps task IDs and saved states intact. */
(function(root){
 const api={
  annotate(sections,rules){for(const section of sections||[]){let group=null,accountSection=false,feedbackSection=false;for(const block of section.blocks||[]){if(block.type==='h3'||block.type==='h4'){group=(rules.groups||[]).find(g=>new RegExp(g.heading).test(block.title))||null;accountSection=/^(?:5\.4\s|账号注销与数据主体权利)/.test(block.title);feedbackSection=/用户反馈|feedbackApiKey/.test(block.title);}if(block.type==='item'&&(feedbackSection||block.text.includes('（反馈功能）')))block.cond='hasFeedbackSystem';if(block.type==='item'&&accountSection)block.cond='hasAccountSystem';if(block.type==='item'&&group)block.permissionRule=group.rules.find(r=>block.text.includes(r.contains))?.requires||group.default;}}},
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
