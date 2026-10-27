/* Personal Pages storage. All user data stays in this origin's browser storage. */
(function(global){
'use strict';
const KEY='release-desk-pages:v1';
const copy=value=>JSON.parse(JSON.stringify(value));
const empty=()=>({schema:1,projects:{}});
function read(){const raw=localStorage.getItem(KEY);if(!raw)return empty();let data;try{data=JSON.parse(raw);}catch(_){throw Error('浏览器记录损坏，请先保留浏览器数据，不要清空存储。');}if(data.schema!==1||!data.projects||typeof data.projects!=='object')throw Error('不支持的本地数据版本');return data;}
function save(data){try{localStorage.setItem(KEY,JSON.stringify(data));}catch(_){throw Error('浏览器空间不足或禁止存储，本次修改未保存。请先导出项目，再整理历史备份。');}}
async function transaction(action){if(!navigator.locks)throw Error('此浏览器不支持安全保存，请使用新版 Chrome、Edge、Safari 或 Firefox，并通过 HTTP/HTTPS 打开。');return navigator.locks.request('release-desk-pages-write',()=>{const data=read();const result=action(data);save(data);return result;});}
function hash(text){let h=0x811c9dc5;for(const byte of new TextEncoder().encode(text)){h^=byte;h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
function parse(text){
 const lines=text.split('\n'), result={title:'Checklist',preamble:[],sections:[],items:[],features:{hasAccountSystem:true,targetMinors:true}};
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
  if(m=raw.match(/^##\s+(.*)$/)){const title=m[1].trim();section={title,id:'s_'+hash(title),blocks:[],collapsible:pending.includes('COLLAPSE'),is_gate:pending.includes('GATE'),guide_only:pending.includes('GUIDE')};result.sections.push(section);pending=[];path=[result.title,title];continue;}
  if(m=raw.match(/^(###|####)\s+(.*)$/)){const title=m[2].trim();blocks().push({type:m[1].length===3?'h3':'h4',title});path.push(title);continue;}
  if(m=raw.match(/^(\s*)[-*]\s+(\[[ xX\-]\])\s*(.*)$/)){
   let body=m[3],cond=null;const condition=body.match(/\s*<!--\s*if:([A-Za-z0-9_]+)\s*-->\s*$/);if(condition){cond=condition[1];body=body.slice(0,condition.index).trimEnd();}body=body.trim();
   const key=path.join(' / ')+'\0'+body;counts[key]=(counts[key]||0)+1;const state=/x/i.test(m[2])?'done':m[2]==='[-]'?'skip':'todo';const start=raw.indexOf(m[2]);
   const item={type:'item',id:'t_'+hash(key+'\0'+counts[key]),level:Math.floor(m[1].replace(/\t/g,'  ').length/2),state,checked:state==='done',text:body,line:i,span:[start,start+3],cond};result.items.push(item);blocks().push(item);continue;
  }
  if(m=raw.match(/^(\s*)[-*]\s+(.*)$/)){blocks().push({type:'bullet',level:Math.floor(m[1].replace(/\t/g,'  ').length/2),text:m[2].trim()});continue;}
  if(m=raw.match(/^(\s*)(\d+)[.)]\s+(.*)$/)){blocks().push({type:'ordered',level:Math.floor(m[1].replace(/\t/g,'  ').length/2),num:Number(m[2]),text:m[3].trim()});continue;}
  if(m=raw.match(/^>\s?(.*)$/)){if(m[1].trim())blocks().push({type:'note',text:m[1].trim()});continue;}
  blocks().push({type:'para',text:s});
 }
 if(fence&&fence.lines.length)blocks().push(fence);return result;
}
function apply(text,states){const parsed=parse(text),lines=text.split('\n');for(const item of parsed.items){const value=states[item.id];if(value===undefined)continue;if(!['todo','done','skip'].includes(value))throw Error('检查状态无效');const [a,b]=item.span;lines[item.line]=lines[item.line].slice(0,a)+({todo:'[ ]',done:'[x]',skip:'[-]'}[value])+lines[item.line].slice(b);}return lines.join('\n');}
function payload(project){const parsed=parse(project.document);const gate=parsed.sections.find(s=>s.is_gate)?.blocks.find(b=>b.type==='item');let n=0;for(const item of parsed.items){item.gate=item.id===gate?.id;item.seq=item.gate?'':++n;}
 const items=parsed.items.filter(x=>!x.gate&&parsed.features[x.cond]!==false);
 return {...parsed,mdName:project.name+'.md',mdText:project.document,generation:project.generation,revision:String(project.version),review:copy(project.review),permSelected:copy(project.permissions.selected),permDescs:copy(project.permissions.descs),permDescsEn:copy(project.permissions.descsEn),gateId:gate?.id||null,gateDone:!gate||gate.state==='done',gateState:gate?.state||'done',total:items.length,done:items.filter(x=>x.state==='done').length,skipped:items.filter(x=>x.state==='skip').length,built:'Pages 个人版'};
}
function get(id){const project=read().projects[id];if(!project)throw Error('项目不存在或已删除，请返回工作台。');return project;}
function state(project){const value=copy(project);delete value.snapshots;return value;}
function validate(input){
 if(!input||typeof input!=='object'||typeof input.document!=='string'||input.document.length>800000||!parse(input.document).items.length)throw Error('清单无效，至少需要一个 Markdown 检查项，且小于 800 KB。');
 const permissions=input.permissions||{selected:[],descs:{},descsEn:{}};const review=input.review||{release:{},items:{},history:[]};
 if(!Array.isArray(permissions.selected)||!permissions.descs||typeof permissions.descs!=='object'||!permissions.descsEn||typeof permissions.descsEn!=='object')throw Error('权限配置无效');
 for(const descs of [permissions.descs,permissions.descsEn])if(Array.isArray(descs)||Object.values(descs).some(v=>typeof v!=='string'||v.length>10000))throw Error('权限用途描述必须为文本');
 const known=new Set(PAGES_DATA.profiles.permissions.map(p=>p.id));if(permissions.selected.some(id=>!known.has(id)))throw Error('包含不支持的权限');
 if(!review||typeof review.release!=='object'||!review.release||typeof review.items!=='object'||!review.items||!Array.isArray(review.history))throw Error('发布记录无效');
 for(const item of Object.values(review.items)){if(!item||typeof item!=='object'||Object.values(item).some(v=>typeof v!=='string'))throw Error('备注字段必须为文本');}
 return {permissions:copy(permissions),review:copy(review)};
}
async function create(input){const checked=validate({...input,document:input.document??PAGES_DATA.document});const name=String(input.name||'').trim();if(!name||name.length>100)throw Error('项目名称需要 1–100 个字符');return transaction(data=>{const id=crypto.randomUUID();data.projects[id]={id,name,document:input.document??PAGES_DATA.document,...checked,version:1,generation:1,createdAt:Date.now(),updatedAt:Date.now(),snapshots:[]};return id;});}
async function mutate(id,version,label,action){return transaction(data=>{const p=data.projects[id];if(!p)throw Error('项目不存在');if(String(version)!==String(p.version))throw Object.assign(Error('另一个页面已更新项目，请先导出草稿，再刷新核对。'),{status:409});const before=state(p);action(p);p.snapshots.unshift({id:crypto.randomUUID(),date:Date.now(),label,state:before});p.snapshots=p.snapshots.slice(0,10);p.version++;p.updatedAt=Date.now();return payload(p);});}
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
async function handle(path,options={}){
 const op=path.split('/').pop(),id=projectId(),p=get(id);const data=options.body?JSON.parse(options.body):{};
 if(op==='list'||op==='reload')return payload(p);if(op==='health')return {ok:true};if(op==='profiles')return PAGES_DATA.profiles;
 if(op==='perm-config')return {...config(data),appendix:appendix(data)};
 if(op==='perm-en-preview'||op==='perm-write-en'){const doc=english(data);return {doc,path:'Privacy-and-Permissions-EN.md',lines:doc.split('\n').length};}
 if(op==='backups')return {backups:p.snapshots.map(x=>x.id),entries:p.snapshots.map(x=>({id:x.id,label:x.label,created_at:x.date/1000}))};
 const updated=await mutate(id,data.revision,op,project=>{
  if(op==='write'){const ids=new Set(parse(project.document).items.map(x=>x.id));if(!data.states||Object.keys(data.states).some(x=>!ids.has(x)))throw Error('检查项已变化');project.document=apply(project.document,data.states);}
  else if(op==='review'){validate({...project,review:data.review});project.review=copy(data.review);}
  else if(op==='features'){const features=data.features;if(!features||['hasAccountSystem','targetMinors'].some(k=>typeof features[k]!=='boolean'))throw Error('项目特征无效');const line='<!-- FEATURES '+Object.entries(features).filter(([k])=>['hasAccountSystem','targetMinors'].includes(k)).map(([k,v])=>k+'='+(v?1:0)).join(' ')+' -->';project.document=/<!--\s*FEATURES\s+[\s\S]*?-->/.test(project.document)?project.document.replace(/<!--\s*FEATURES\s+[\s\S]*?-->/,line):line+'\n'+project.document;}
  else if(op==='ack'||op==='unack'){const gate=payload(project).gateId;if(gate)project.document=apply(project.document,{[gate]:op==='ack'?'done':'skip'});}
  else if(op==='clear'){const d=payload(project);project.document=apply(project.document,Object.fromEntries(d.items.filter(x=>!x.gate).map(x=>[x.id,'todo'])));project.generation++;}
  else if(op==='perm-write'){const permissions={selected:data.selected||[],descs:data.descs||{},descsEn:data.descsEn||{}};validate({...project,permissions});project.permissions=copy(permissions);project.document=replaceAppendix(project.document,appendix(permissions));}
  else if(op==='restore'){const selected=project.snapshots.find(x=>x.id===data.name);if(!selected)throw Error('备份不存在');const version=project.version;Object.assign(project,copy(selected.state));project.version=version;project.generation++;}
  else throw Error('不支持的操作：'+op);
 });
 if(op==='clear')updated.cleared=payload(p).items.filter(x=>!x.gate&&x.state!=='todo').length;
 return updated;
}
function install(){global.RELEASE_PAGES={projectId:projectId()};const native=global.fetch.bind(global);global.fetch=async(path,options)=>{if(typeof path==='string'&&path.startsWith('/api/')){try{return new Response(JSON.stringify(await handle(path,options)),{status:200,headers:{'Content-Type':'application/json'}});}catch(error){return new Response(JSON.stringify({error:error.message}),{status:error.status||400,headers:{'Content-Type':'application/json'}});}}return native(path,options);};}
global.PagesStore={KEY,read,get,parse,apply,payload,create,mutate,config,english,download,escape,projectId,install,openProject:()=>payload(get(projectId())),list:()=>Object.values(read().projects).sort((a,b)=>b.updatedAt-a.updatedAt),export:id=>({format:'release-desk/v1',...state(get(id))}),remove:id=>transaction(data=>{delete data.projects[id];})};
})(window);
