/* Personal Pages storage. All user data stays in this origin's browser storage. */
(function(global){
'use strict';
const KEY='release-desk-pages:v1';
const copy=value=>JSON.parse(JSON.stringify(value));
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const conflict=()=>Object.assign(Error('本机数据已变化，请重新查看差异后再拉取。'),{status:409});
const empty=()=>({schema:1,projects:{}});
function read(){const raw=localStorage.getItem(KEY);if(!raw)return empty();let data;try{data=JSON.parse(raw);}catch(_){throw Error('浏览器记录损坏，请先保留浏览器数据，不要清空存储。');}if((data.storageVersion||1)>2)throw Error('本地数据版本较新，请更新网页后再操作');if(data.schema!==1||!data.projects||typeof data.projects!=='object')throw Error('不支持的本地数据版本');return data;}
function save(data,serialized=JSON.stringify(data)){try{localStorage.setItem(KEY,serialized);}catch(_){throw Error('浏览器空间不足或禁止存储，本次修改未保存。请先导出项目，再整理历史备份。');}}
async function transaction(action){if(!navigator.locks)throw Error('此浏览器不支持安全保存，请使用新版 Chrome、Edge、Safari 或 Firefox，并通过 HTTP/HTTPS 打开。');return navigator.locks.request('release-desk-pages-write',()=>{const before=localStorage.getItem(KEY);const data=read();const result=action(data);const serialized=JSON.stringify(data);if(serialized!==before)save(data,serialized);return result;});}
function hash(text){let h=0x811c9dc5;for(const byte of new TextEncoder().encode(text)){h^=byte;h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
const parseCache=new Map();
function copyParsed(value){const result=copy(value),items=new Map(result.items.map(item=>[item.id,item]));for(const section of result.sections)section.blocks=section.blocks.map(block=>block.type==='item'?items.get(block.id):block);result.preamble=result.preamble.map(block=>block.type==='item'?items.get(block.id):block);return result;}
function parse(text){
 if(parseCache.has(text)){const cached=parseCache.get(text);parseCache.delete(text);parseCache.set(text,cached);return copyParsed(cached);}
 const result=parseDocument(text);parseCache.set(text,result);while(parseCache.size>16)parseCache.delete(parseCache.keys().next().value);return copyParsed(result);
}
function parseDocument(text){
 const lines=text.split('\n'), result={title:'Checklist',preamble:[],sections:[],items:[],features:{hasAccountSystem:true,targetMinors:true,hasFeedbackSystem:false,hasSubscriptions:true,hasPush:false}};
 let section=null,path=[],fence=null,pending=[];const counts={};const blocks=()=>section?section.blocks:result.preamble;
 const features=text.match(/<!--\s*FEATURES\s+([\s\S]*?)-->/);if(features)for(const kv of features[1].matchAll(/([A-Za-z0-9_]+)\s*=\s*([01])/g))result.features[kv[1]]=kv[2]==='1';
 for(let i=0;i<lines.length;i++){
  const raw=lines[i],s=raw.trim();let m;
  if(/^\s*```/.test(raw)){if(fence){blocks().push(fence);fence=null;}else fence={type:'code',lang:s.slice(3).trim(),lines:[]};continue;}
  if(fence){fence.lines.push(raw);continue;}
  if(!s||/^\s*-{3,}\s*$/.test(raw)||/<!--\s*FEATURES\s+/.test(raw))continue;
  if(m=raw.match(/^\s*<!--\s*([A-Za-z0-9_-]+)\s*-->\s*$/)){const flag=m[1].toUpperCase();if(section){if(flag==='GATE')section.is_gate=true;if(flag==='GUIDE')section.guide_only=true;if(flag==='COLLAPSE')section.collapsible=true;}else pending.push(flag);continue;}
  if(s.startsWith('|')){const rows=[];while(i<lines.length&&lines[i].trim().startsWith('|')){const row=lines[i].trim();if(!/^\s*\|[\s:|-]+\|\s*$/.test(row))rows.push(row.replace(/^\|+|\|+$/g,'').split('|').map(x=>x.trim()));i++;}i--;if(rows.length)blocks().push({type:'table',rows});continue;}
  if(m=raw.match(/^#\s+(.*)$/)){result.title=m[1].trim();path=[result.title];continue;}
  if(m=raw.match(/^##\s+(.*)$/)){let title=m[1].trim();const fixed=title.match(/\s*<!-- section:([A-Za-z0-9_-]+) -->\s*$/);if(fixed)title=title.slice(0,fixed.index).trimEnd();section={title,id:fixed?fixed[1]:'s_'+hash(title),blocks:[],collapsible:pending.includes('COLLAPSE'),is_gate:pending.includes('GATE'),guide_only:pending.includes('GUIDE')};result.sections.push(section);pending=[];path=[result.title,title];continue;}
  if(m=raw.match(/^(###|####)\s+(.*)$/)){const title=m[2].trim();blocks().push({type:m[1].length===3?'h3':'h4',title});path.push(title);continue;}
  if(m=raw.match(/^(\s*)[-*]\s+(\[[ xX\-]\])\s*(.*)$/)){
   let body=m[3],cond=null;const fixed=body.match(/\s*<!-- task:([A-Za-z0-9_-]+) -->\s*$/);if(fixed)body=body.slice(0,fixed.index).trimEnd();const condition=body.match(/\s*<!--\s*if:([A-Za-z0-9_]+)\s*-->\s*$/);if(condition){cond=condition[1];body=body.slice(0,condition.index).trimEnd();}body=body.trim();
   const key=path.join(' / ')+'\0'+body;counts[key]=(counts[key]||0)+1;const state=/x/i.test(m[2])?'done':m[2]==='[-]'?'skip':'todo';const start=raw.indexOf(m[2]);
   const item={type:'item',id:fixed?fixed[1]:'t_'+hash(key+'\0'+counts[key]),level:Math.floor(m[1].replace(/\t/g,'  ').length/2),state,checked:state==='done',text:body,line:i,span:[start,start+3],cond};result.items.push(item);blocks().push(item);continue;
  }
  if(m=raw.match(/^(\s*)[-*]\s+(.*)$/)){blocks().push({type:'bullet',level:Math.floor(m[1].replace(/\t/g,'  ').length/2),text:m[2].trim()});continue;}
  if(m=raw.match(/^(\s*)(\d+)[.)]\s+(.*)$/)){blocks().push({type:'ordered',level:Math.floor(m[1].replace(/\t/g,'  ').length/2),num:Number(m[2]),text:m[3].trim()});continue;}
  if(m=raw.match(/^>\s?(.*)$/)){if(m[1].trim())blocks().push({type:'note',text:m[1].trim()});continue;}
  blocks().push({type:'para',text:s});
 }
 if(fence&&fence.lines.length)blocks().push(fence);return result;
}
function stabilize(text){
 const parsed=parse(text),lines=text.split('\n');
 for(const item of parsed.items)if(!/<!-- task:[A-Za-z0-9_-]+ -->\s*$/.test(lines[item.line]))lines[item.line]+=' <!-- task:'+item.id+' -->';
 let fence=false;for(let i=0;i<lines.length;i++){if(/^\s*```/.test(lines[i]))fence=!fence;const match=lines[i].match(/^##\s+(.*)$/);if(!fence&&match&&!lines[i].includes('<!-- section:'))lines[i]+=' <!-- section:s_'+hash(match[1].trim())+' -->';}
 return lines.join('\n');
}
function apply(text,states){const parsed=parse(text),lines=text.split('\n');for(const item of parsed.items){const value=states[item.id];if(value===undefined)continue;if(!['todo','done','skip'].includes(value))throw Error('检查状态无效');const [a,b]=item.span;lines[item.line]=lines[item.line].slice(0,a)+({todo:'[ ]',done:'[x]',skip:'[-]'}[value])+lines[item.line].slice(b);}return lines.join('\n');}
function payload(project){const parsed=parse(project.document);global.PermissionVisibility.annotate(parsed.sections,PAGES_DATA.rules);const gate=parsed.sections.find(s=>s.is_gate||s.title.includes('确认已了解使用说明'))?.blocks.find(b=>b.type==='item');let n=0;for(const item of parsed.items){item.gate=item.id===gate?.id;item.seq=item.gate?'':++n;}
 const items=parsed.items.filter(x=>!x.gate&&parsed.features[x.cond]!==false&&global.PermissionVisibility.visible(x.permissionRule,project.permissions.selected,PAGES_DATA.profiles));
 return {...parsed,mdName:project.name+'.md',mdText:project.document,generation:project.generation,revision:String(project.version),review:copy(project.review),permSelected:copy(project.permissions.selected),permDescs:copy(project.permissions.descs),permDescsEn:copy(project.permissions.descsEn),gateId:gate?.id||null,gateDone:!gate||gate.state==='done',gateState:gate?.state||'done',total:items.length,done:items.filter(x=>x.state==='done').length,skipped:items.filter(x=>x.state==='skip').length,built:'Pages 个人版'};
}
function get(id){const project=validId(id)?read().projects[id]:null;if(!project)throw Error('项目不存在或已删除，请返回工作台。');return project;}
function state(project){const value=copy(project);delete value.snapshots;return value;}
function validate(input){
 if(!input||typeof input!=='object'||typeof input.document!=='string'||input.document.length>800000||!parse(input.document).items.length)throw Error('清单无效，至少需要一个 Markdown 检查项，且小于 800 KB。');
 const parsed=parse(input.document);if(new Set(parsed.items.map(x=>x.id)).size!==parsed.items.length)throw Error('检查项 ID 重复，请修正文件后再导入');
 const permissions=input.permissions||{selected:[],descs:{},descsEn:{}};const review=input.review||{release:{},items:{},history:[]};
 if(!Array.isArray(permissions.selected)||!permissions.descs||typeof permissions.descs!=='object'||!permissions.descsEn||typeof permissions.descsEn!=='object')throw Error('权限配置无效');
 for(const descs of [permissions.descs,permissions.descsEn])if(Array.isArray(descs)||Object.values(descs).some(v=>typeof v!=='string'||v.length>10000))throw Error('权限用途描述必须为文本');
 const known=new Set(PAGES_DATA.profiles.permissions.map(p=>p.id));if(permissions.selected.some(id=>!known.has(id)))throw Error('包含不支持的权限');
 if(!review||typeof review.release!=='object'||!review.release||typeof review.items!=='object'||!review.items||!Array.isArray(review.history))throw Error('发布记录无效');
 if(review.subscriptions!==undefined&&(!Array.isArray(review.subscriptions)||review.subscriptions.length>100||review.subscriptions.some(p=>!p||typeof p!=='object'||Array.isArray(p)||Object.values(p).some(v=>typeof v!=='string'||v.length>4000))))throw Error('订阅商品配置无效，最多 100 个商品，字段须为文本');
 for(const item of Object.values(review.items)){if(!item||typeof item!=='object'||Object.values(item).some(v=>typeof v!=='string'))throw Error('备注字段必须为文本');}
 return {permissions:copy(permissions),review:copy(review)};
}
async function create(input){const checked=validate({...input,document:input.document??PAGES_DATA.document});const name=String(input.name||'').trim();if(!name||name.length>100)throw Error('项目名称需要 1–100 个字符');return transaction(data=>{const id=crypto.randomUUID();data.projects[id]={id,name,document:stabilize(input.document??PAGES_DATA.document),dataVersion:2,templateVersion:input.templateVersion||(input.document?'custom':PAGES_DATA.templateVersion),templateBaseline:Object.fromEntries(parse(input.document??PAGES_DATA.document).items.map(x=>[x.id,x.text])),...checked,version:1,generation:1,createdAt:Date.now(),updatedAt:Date.now(),snapshots:[]};return id;});}
async function mutate(id,version,label,action){return transaction(data=>{const p=data.projects[id];if(!p)throw Error('项目不存在');if(String(version)!==String(p.version))throw Object.assign(Error('另一个页面已更新项目，请先导出草稿，再刷新核对。'),{status:409});const before=state(p);p.document=stabilize(p.document);p.dataVersion=2;action(p);if(JSON.stringify(before)===JSON.stringify(state(p)))return payload(p);p.snapshots.unshift({id:crypto.randomUUID(),date:Date.now(),label,state:before});p.snapshots=p.snapshots.slice(0,10);p.version++;p.updatedAt=Date.now();return payload(p);});}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function keys(p){const ios=p.ios||{};return ios.infoplist_keys|| (ios.infoplist_key?[{key:ios.infoplist_key,desc:ios.desc||'',desc_en:ios.desc_en||''}]:[]);}
function config(data){const profiles=PAGES_DATA.profiles,en=data.lang==='en',ios=[],android=[],appstore=[],policy=[],checks=[],missing=[];
 for(const id of data.selected||[]){const p=profiles.permissions.find(p=>p.id===id);if(!p)continue;const i=p.ios||{},a=p.android||{};const name=en?(p.name_en||p.name):p.name;
 for(const k of keys(p)){const primary=en?data.descsEn:data.descs,secondary=en?data.descs:data.descsEn;const desc=(primary?.[id]??(en?k.desc_en:k.desc))||secondary?.[id]||'';if(!desc.trim())missing.push(p.name+'：缺少用途描述');ios.push('<key>'+escape(k.key)+'</key>\n<string>'+escape(desc)+'</string>');}
 if(a.manifest){android.push('<uses-permission android:name="'+escape(a.manifest)+'" />');checks.push('〔'+name+'〕Android '+(a.runtime?'运行时权限，需动态申请':'普通权限'));}else if(a.manifest_note)checks.push('〔'+name+'〕'+a.manifest_note);
 for(const label of i.appstore_labels||[]){const cn=profiles.appstore_data_types.find(x=>x.en===label)?.name||label;const entry=cn+'（'+label+'）';if(!appstore.includes(entry))appstore.push(entry);}
 const text=en?(p.policy_text_en||p.policy_text):p.policy_text;if(text)policy.push('- **'+name+'**：'+text);for(const note of (en?p.review_notes_en||p.review_notes:p.review_notes)||[])checks.push('〔'+name+'〕'+note);
 }return {iosPlist:ios.join('\n'),androidManifest:android.join('\n'),appstore,privacyPolicy:policy.join('\n'),checks,missing};
}
function englishAppendix(data){
 const english=config({...data,descs:{},lang:'en'});
 const explanations=(data.selected||[]).map(id=>{
  const p=PAGES_DATA.profiles.permissions.find(p=>p.id===id);if(!p)return '';
  const defaults=[...new Set(keys(p).map(k=>k.desc_en).filter(Boolean))].join(' ');
  const description=data.descsEn?.[id]||defaults||p.android?.desc_en||p.policy_text_en||"Please provide an English description of this permission's purpose.";
  return '- **'+(p.name_en||p.id)+'**: '+description;
 }).filter(Boolean).join('\n');
 return ['### 英文权限用途说明（English Permission Descriptions）','',explanations,'','### iOS Info.plist（English）','','```xml',english.iosPlist||'<!-- No permission usage descriptions required -->','```','','### 英文隐私政策文案（Privacy Policy Copy）','',english.privacyPolicy||'_No permission-specific privacy policy copy configured._',''].join('\n');
}
function appendix(data){const cfg=config({...data,lang:'zh'});return '<!-- PERMISSION_APPENDIX -->\n## 附录：权限与隐私配置\n\n### iOS Info.plist\n\n```xml\n'+cfg.iosPlist+'\n```\n\n### Android Manifest\n\n```xml\n'+cfg.androidManifest+'\n```\n\n### 隐私政策文案\n\n'+cfg.privacyPolicy+'\n\n'+englishAppendix(data)+'\n### App Store 隐私信息\n\n'+cfg.appstore.map(x=>'- '+x).join('\n')+'\n\n### 核对提示\n\n'+cfg.checks.map(x=>'- '+x).join('\n')+'\n<!-- PERMISSION_APPENDIX_END -->\n';}
function replaceAppendix(text,content){const start=text.indexOf('<!-- PERMISSION_APPENDIX -->');if(start<0)return text.trimEnd()+'\n\n'+content;const end=text.indexOf('<!-- PERMISSION_APPENDIX_END -->',start);if(end>=0)return text.slice(0,start)+content+text.slice(end+'<!-- PERMISSION_APPENDIX_END -->'.length);const tail=text.slice(start).match(/^## (?!附录：权限与隐私配置).+/m);return text.slice(0,start)+content+(tail?'\n'+text.slice(start+tail.index):'');}
function english(data){const cfg=config({...data,lang:'en'});return ['# Privacy and Permissions — Draft','','Complete all placeholders and verify this draft against your actual data practices before publishing.','','App: [APP NAME]','Contact: [CONTACT EMAIL]','Last updated: [DATE]','','## Selected permissions',cfg.privacyPolicy,'','## iOS usage descriptions','```xml',cfg.iosPlist,'```','','## Android permissions','```xml',cfg.androidManifest,'```','','## Review checklist',...cfg.checks.map(x=>'- '+x),'','## Data practices to complete','- Data collected, purposes, retention and deletion','- Third-party SDKs, sharing and tracking','- User rights and contact information','- Children and regional requirements'].join('\n');}
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const projectId=()=>new URLSearchParams(location.search).get('id');
let initialization;
function initialize(){
 if(initialization)return initialization;
 initialization=transaction(data=>{
  let migrated=0;
  for(const project of Object.values(data.projects)){
   if((project.dataVersion||1)>=2)continue;
   validate(project);
   project.snapshots=project.snapshots||[];
   project.snapshots.unshift({id:crypto.randomUUID(),date:Date.now(),label:'升级前完整备份',state:state(project)});
   project.snapshots=project.snapshots.slice(0,10);
   project.document=stabilize(project.document);project.dataVersion=2;project.templateVersion=project.templateVersion||'legacy';project.templateBaseline=project.templateBaseline||Object.fromEntries(parse(project.document).items.map(x=>[x.id,x.text]));migrated++;
  }
  data.storageVersion=2;
  return {migrated};
 });return initialization;
}
function validDraft(draft){return !!draft&&typeof draft==='object'&&!Array.isArray(draft)&&!!draft.state&&typeof draft.state==='object'&&!Array.isArray(draft.state)&&Object.entries(draft.state).every(([id,value])=>!!id&&['todo','done','skip',true,false].includes(value));}
function exportAll(){const data=read(),drafts={};for(const id of Object.keys(data.projects)){const raw=localStorage.getItem('app-release-checklist-state-v2:pages:'+id);if(raw){try{const parsed=JSON.parse(raw);drafts[id]=validDraft(parsed)?parsed:{unreadable:raw};}catch(_){drafts[id]={unreadable:raw};}}}return {format:'release-desk-workspace/v1',exportedAt:new Date().toISOString(),projects:Object.values(data.projects).map(p=>({format:'release-desk/v1',...copy(p)})),drafts};}
function inspectImportAll(bundle){
 if(!bundle||bundle.format!=='release-desk-workspace/v1'||!Array.isArray(bundle.projects)||bundle.projects.length>100)throw Error('请选择完整工作台备份，最多一次导入 100 个项目');
 const names=[],ids=new Set();let snapshots=0;
 for(const input of bundle.projects){
  if(!validId(input.id)||ids.has(input.id))throw Error('备份中有项目 ID 格式无效或重复');ids.add(input.id);
  validate(input);const name=String(input.name||'导入项目').trim();if(!name||name.length>100)throw Error('备份中有项目名称无效');names.push(name);
  if(input.snapshots!==undefined&&!Array.isArray(input.snapshots))throw Error('项目快照格式无效');
  if((input.snapshots||[]).length>10)throw Error('单个项目最多保留 10 份快照');const saved=input.snapshots||[];snapshots+=saved.length;
  for(const item of saved){if(!item||!validId(item.id)||!Number.isFinite(item.date))throw Error('快照 ID 或日期无效');validate(item.state);}
  for(const key of ['version','generation'])if(!Number.isSafeInteger(input[key])||input[key]<1||input[key]>=Number.MAX_SAFE_INTEGER)throw Error('项目版本无效');
 }
 const draftMap=bundle.drafts||{};if(!draftMap||typeof draftMap!=='object'||Array.isArray(draftMap))throw Error('备份中的浏览器草稿格式无效');
 const draftIds=Object.keys(draftMap);if(draftIds.length>ids.size||draftIds.some(id=>!ids.has(id)))throw Error('备份中存在没有对应项目的浏览器草稿');let unreadableDrafts=0;
 for(const id of draftIds){const draft=draftMap[id];if(draft&&typeof draft==='object'&&!Array.isArray(draft)&&typeof draft.unreadable==='string'){unreadableDrafts++;continue;}if(!validDraft(draft))throw Error('浏览器草稿格式或检查状态无效：'+id);}
 return {projects:names.length,names,snapshots,drafts:draftIds.length-unreadableDrafts,unreadableDrafts,exportedAt:bundle.exportedAt||null};
}
function mergeSnapshots(...groups){const seen=new Set();return groups.flat().filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;}).sort((a,b)=>Number(b.date)-Number(a.date)).slice(0,10).map(copy);}
function workspaceToken(){return JSON.stringify(exportAll(),(key,value)=>key==='exportedAt'?undefined:value);}
async function mergeRemoteAll(bundle,expectedToken){
 inspectImportAll(bundle);const incomingIds=new Set(bundle.projects.map(p=>p.id)),localOnly=Object.keys(read().projects).filter(id=>!incomingIds.has(id)).length;let added=0,updated=0;
 await transaction(data=>{
  if(expectedToken!==undefined&&workspaceToken()!==expectedToken)throw conflict();
  for(const input of bundle.projects){
   const checked=validate(input),current=data.projects[input.id],remote={...copy(input),...checked,id:input.id};
   remote.snapshots=(remote.snapshots||[]).map(snapshot=>({...snapshot,state:{...snapshot.state,id:input.id}}));
   if(current){
    const before=state(current),after=state(remote);
    if(JSON.stringify(before)!==JSON.stringify(after)){
     remote.snapshots=mergeSnapshots([{id:crypto.randomUUID(),date:Date.now(),label:'GitHub 同步前保留的本机版本',state:before}],remote.snapshots,current.snapshots||[]);
     updated++;
    }else remote.snapshots=mergeSnapshots(remote.snapshots,current.snapshots||[]);
    remote.version=Math.max(current.version,remote.version)+1;
    remote.generation=Math.max(current.generation,remote.generation)+1;remote.updatedAt=Date.now();
   }else added++;
   data.projects[input.id]=remote;
  }
 });
 let draftError=Object.values(bundle.drafts||{}).some(draft=>typeof draft?.unreadable==='string');
 for(const id of incomingIds){
  const targetId=id,localKey='app-release-checklist-state-v2:pages:'+targetId,existing=localStorage.getItem(localKey),remote=bundle.drafts?.[id];
  const project=get(targetId),validIds=new Set(parse(project.document).items.map(item=>item.id));
  let chosen=null;
  if(existing){try{chosen=JSON.parse(existing);}catch(_){draftError=true;}}
  else if(remote&&remote.state&&typeof remote.state==='object')chosen=copy(remote);
  if(chosen&&chosen.state&&typeof chosen.state==='object'){
   const state={};for(const [itemId,value] of Object.entries(chosen.state))if(validIds.has(itemId)&&['todo','done','skip',true,false].includes(value))state[itemId]=value;
   chosen={...chosen,__gen:project.generation,revision:String(project.version),state};
   try{localStorage.setItem(localKey,JSON.stringify(chosen));}catch(_){draftError=true;}
  }
 }
 return {added,updated,draftError,localOnly};
}
async function importAll(bundle){
 inspectImportAll(bundle);
 const drafts=[];
 const ids=await transaction(data=>bundle.projects.map(input=>{
  const checked=validate(input),id=crypto.randomUUID(),name=String(input.name||'导入项目').slice(0,100);
  const project={id,name,document:stabilize(input.document),...checked,version:1,generation:1,createdAt:Date.now(),updatedAt:Date.now(),dataVersion:2,templateVersion:input.templateVersion||'legacy',templateBaseline:input.templateBaseline||Object.fromEntries(parse(input.document).items.map(x=>[x.id,x.text])),snapshots:[]};
  project.snapshots=(input.snapshots||[]).slice(0,10).map(saved=>{validate(saved.state);return {id:crypto.randomUUID(),date:Number(saved.date)||Date.now(),label:String(saved.label||'导入快照'),state:{...copy(saved.state),id}};});
  data.projects[id]=project;
  if(bundle.drafts?.[input.id]?.state)drafts.push([id,{...bundle.drafts[input.id],revision:'1',__gen:1}]);
  return id;
 }));
 let draftError=Object.values(bundle.drafts||{}).some(draft=>typeof draft?.unreadable==='string');for(const [id,draft] of drafts){try{localStorage.setItem('app-release-checklist-state-v2:pages:'+id,JSON.stringify(draft));}catch(_){draftError=true;}}
 return {ids,draftError};
}
async function markExport(){return transaction(data=>{data.lastBackupAt=Date.now();return data.lastBackupAt;});}
async function updateTemplate(id,version){return mutate(id,version,'更新清单模板前备份',p=>{
 const old=parse(p.document),fresh=parse(PAGES_DATA.document);const states=Object.fromEntries(old.items.map(x=>[x.id,x.state]));
 const oldIds=new Set(old.items.map(x=>x.id)),freshIds=new Set(fresh.items.map(x=>x.id));
 const additions=fresh.sections.map(section=>{const items=section.blocks.filter(b=>b.type==='item'&&!oldIds.has(b.id));return items.length?'### 新增检查 · '+section.title+'\n'+items.map(x=>PAGES_DATA.document.split('\n')[x.line]).join('\n'):'';}).filter(Boolean);
 if(additions.length)p.document+='\n\n## 模板新增检查 <!-- section:template_additions -->\n'+additions.join('\n\n')+'\n';
 // Update wording only for known stable items. Keep user-added/removed-in-template items and all notes.
 let lines=p.document.split('\n');const freshMap=new Map(fresh.items.map(x=>[x.id,x]));
 for(const item of old.items){const next=freshMap.get(item.id);if(!next)continue;if(p.templateBaseline?.[item.id]&&p.templateBaseline[item.id]!==item.text)continue;const raw=PAGES_DATA.document.split('\n')[next.line];lines[item.line]=raw.replace(/\[[ xX-]\]/,({done:'[x]',skip:'[-]',todo:'[ ]'})[item.state]);}
 p.document=lines.join('\n');p.templateBaseline=Object.fromEntries(fresh.items.map(x=>[x.id,x.text]));p.templateVersion=PAGES_DATA.templateVersion;p.dataVersion=2;
 });}
async function handle(path,options={}){
 await initialize();const op=path.split('/').pop(),id=projectId(),p=get(id);const data=options.body?JSON.parse(options.body):{};
 if(op==='list'||op==='reload')return payload(p);if(op==='health')return {ok:true};if(op==='profiles')return PAGES_DATA.profiles;
 if(op==='perm-config')return {...config(data),appendix:appendix(data)};
 if(op==='perm-en-preview'||op==='perm-write-en'){const doc=english(data);return {doc,path:'Privacy-and-Permissions-EN.md',lines:doc.split('\n').length};}
 if(op==='backups')return {backups:p.snapshots.map(x=>x.id),entries:p.snapshots.map(x=>({id:x.id,label:x.label,created_at:x.date/1000}))};
 const updated=await mutate(id,data.revision,op,project=>{
  if(op==='write'){const ids=new Set(parse(project.document).items.map(x=>x.id));if(!data.states||Object.keys(data.states).some(x=>!ids.has(x)))throw Error('检查项已变化');project.document=apply(project.document,data.states);}
  else if(op==='review'){validate({...project,review:data.review});project.review=copy(data.review);}
  else if(op==='features'){const features={hasFeedbackSystem:false,hasSubscriptions:true,hasPush:false,...data.features};if(!features||['hasAccountSystem','targetMinors','hasFeedbackSystem','hasSubscriptions','hasPush'].some(k=>typeof features[k]!=='boolean'))throw Error('项目特征无效');const line='<!-- FEATURES '+Object.entries(features).filter(([k])=>['hasAccountSystem','targetMinors','hasFeedbackSystem','hasSubscriptions','hasPush'].includes(k)).map(([k,v])=>k+'='+(v?1:0)).join(' ')+' -->';project.document=/<!--\s*FEATURES\s+[\s\S]*?-->/.test(project.document)?project.document.replace(/<!--\s*FEATURES\s+[\s\S]*?-->/,line):line+'\n'+project.document;}
  else if(op==='ack'||op==='unack'){const gate=payload(project).gateId;if(gate)project.document=apply(project.document,{[gate]:op==='ack'?'done':'skip'});}
  else if(op==='clear'){const d=payload(project);project.document=apply(project.document,Object.fromEntries(d.items.filter(x=>!x.gate).map(x=>[x.id,'todo'])));project.generation++;}
  else if(op==='perm-write'){const permissions={selected:data.selected||[],descs:data.descs||{},descsEn:data.descsEn||{}};validate({...project,permissions});project.permissions=copy(permissions);project.document=replaceAppendix(project.document,appendix(permissions));}
  else if(op==='new-release'){
   if(typeof data.keepNotes!=='boolean'||typeof data.keepEvidence!=='boolean'||!data.release||typeof data.release.version!=='string'||!data.release.version.trim())throw Error('请填写新版本号及备注保留选项');
   const before=payload(project);project.review.history=project.review.history||[];
   project.review.history.push({subscriptions:copy(project.review.subscriptions||[]),release:copy(project.review.release),date:new Date().toISOString(),features:copy(before.features),permissions:copy(project.permissions),items:before.items.filter(x=>!x.gate).map(x=>({id:x.id,text:x.text,state:x.state,applicable:before.features[x.cond]!==false&&global.PermissionVisibility.visible(x.permissionRule,project.permissions.selected,PAGES_DATA.profiles),...project.review.items[x.id]}))});
   project.document=apply(project.document,Object.fromEntries(before.items.filter(x=>!x.gate).map(x=>[x.id,'todo'])));
   const next={};for(const [key,item] of Object.entries(project.review.items)){const saved={};if(data.keepNotes){if(item.notes)saved.notes=item.notes;if(item.reason)saved.reason=item.reason;}if(data.keepEvidence&&item.evidence)saved.evidence=item.evidence;if(Object.keys(saved).length)next[key]=saved;}
   project.review.items=next;project.review.release=copy(data.release);project.generation++;
  }
  else if(op==='restore'){const selected=project.snapshots.find(x=>x.id===data.name);if(!selected)throw Error('备份不存在');const version=project.version;Object.assign(project,copy(selected.state));project.version=version;project.generation++;}
  else throw Error('不支持的操作：'+op);
 });
 if(op==='clear')updated.cleared=payload(p).items.filter(x=>!x.gate&&x.state!=='todo').length;
 return updated;
}
function install(){global.RELEASE_PAGES={projectId:projectId()};initialize().catch(()=>{});const native=global.fetch.bind(global);global.fetch=async(path,options)=>{if(typeof path==='string'&&path.startsWith('/api/')){try{return new Response(JSON.stringify(await handle(path,options)),{status:200,headers:{'Content-Type':'application/json'}});}catch(error){return new Response(JSON.stringify({error:error.message}),{status:error.status||400,headers:{'Content-Type':'application/json'}});}}return native(path,options);};}
global.PagesStore={KEY,validId,mergeSnapshots,workspaceToken,initialize,exportAll,inspectImportAll,importAll,mergeRemoteAll,markExport,updateTemplate,stabilize,read,get,parse,apply,payload,create,mutate,config,english,download,escape,projectId,install,openProject:()=>payload(get(projectId())),list:()=>Object.values(read().projects).sort((a,b)=>b.updatedAt-a.updatedAt),export:id=>({format:'release-desk/v1',...state(get(id))}),remove:id=>transaction(data=>{delete data.projects[id];})};
})(window);
