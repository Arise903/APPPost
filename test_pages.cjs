const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {webcrypto}=require('node:crypto');const {execFileSync}=require('node:child_process');
function setup(){const memory=new Map();let blocked=false,queue=Promise.resolve();const localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>{if(blocked)throw Error('quota');memory.set(k,v);}};const context=vm.createContext({window:{},localStorage,navigator:{locks:{request:(_name,action)=>{const next=queue.then(action);queue=next.catch(()=>{});return next;}}},crypto:webcrypto,TextEncoder,Response,URL,URLSearchParams,location:{search:''},setTimeout,Blob});vm.runInContext(fs.readFileSync('docs/data.js','utf8'),context);vm.runInContext(fs.readFileSync('permission_visibility.js','utf8'),context);vm.runInContext(fs.readFileSync('pages/store.js','utf8'),context);return {S:context.window.PagesStore,block:()=>blocked=true,context};}
test('Markdown parser keeps Python IDs, spans, and conditions',()=>{const {S}=setup();const expected=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',"import json,checklist_tool as c;from pathlib import Path;print(json.dumps(c.parse_md(Path('online/default_checklist.md').read_text()),ensure_ascii=False))"],{encoding:'utf8'}));const actual=S.parse(fs.readFileSync('online/default_checklist.md','utf8'));assert.deepEqual(JSON.parse(JSON.stringify(actual.items)),expected.items);});
test('Save, revision conflict and complete snapshot restore',async()=>{const {S}=setup();const id=await S.create({name:'Test'});const before=S.get(id);const item=S.payload(before).items.find(x=>!x.gate);await S.mutate(id,1,'write',p=>p.document=S.apply(p.document,{[item.id]:'done'}));await assert.rejects(S.mutate(id,1,'stale',p=>p.name='Wrong'),/另一个页面/);assert.equal(S.get(id).name,'Test');assert.equal(S.payload(S.get(id)).items.find(x=>x.id===item.id).state,'done');const snapshot=S.get(id).snapshots[0];await S.mutate(id,2,'restore',p=>{const version=p.version;Object.assign(p,snapshot.state);p.version=version;});assert.equal(S.payload(S.get(id)).items.find(x=>x.id===item.id).state,'todo');assert.equal(S.get(id).version,3);});
test('Quota errors leave saved projects untouched',async()=>{const {S,block}=setup();await S.create({name:'Saved'});block();await assert.rejects(S.create({name:'Not saved'}),/未保存/);assert.equal(S.list().length,1);});
test('Full export/import preserves notes and validates permissions',async()=>{const {S}=setup();const id=await S.create({name:'Original'});await S.mutate(id,1,'review',p=>p.review={release:{version:'2'},items:{note:{notes:'evidence'}},history:[{version:'1'}]});const exported=S.export(id);const imported=await S.create({...exported,name:'Imported'});assert.equal(S.get(imported).review.items.note.notes,'evidence');assert.equal(S.get(imported).review.history.length,1);await assert.rejects(S.create({name:'Bad',permissions:{selected:['unknown'],descs:{},descsEn:{}}}),/不支持/);});
test('Permission XML escapes custom descriptions',()=>{const {S}=setup();const cfg=S.config({selected:['camera'],descs:{camera:'A & B < C'},descsEn:{}});assert.match(cfg.iosPlist,/A &amp; B &lt; C/);});

test('Imported checklist without guide gate remains usable',async()=>{const {S}=setup();const id=await S.create({name:'Simple',document:'# Simple\n\n## Tasks\n- [ ] One\n'});assert.equal(S.payload(S.get(id)).gateDone,true);});

test('Permission appendix includes custom English copy and English policy',async()=>{
 const {S,context}=setup();const id=await S.create({name:'Bilingual'});
 context.location.search='?id='+id;context.window.fetch=async()=>{throw Error('Unexpected network request');};S.install();
 const response=await context.window.fetch('/api/perm-write',{method:'POST',body:JSON.stringify({revision:'1',selected:['tracking'],descs:{tracking:'中文用途'},descsEn:{tracking:'Measure campaigns & improve ads.'}})});
 assert.equal(response.status,200);const data=await response.json();
 assert.match(data.mdText,/英文权限用途说明/);assert.match(data.mdText,/Measure campaigns & improve ads\./);assert.match(data.mdText,/Measure campaigns &amp; improve ads\./);assert.match(data.mdText,/Cross-app tracking permission is used/);assert.match(data.mdText,/中文用途/);
 const count=S.parse(data.mdText).items.length;assert.equal(count,S.parse(S.export(id).document).items.length);
});

test('Legacy guide confirmation keeps identity and does not consume checklist numbering',async()=>{
 const {S}=setup();const id=await S.create({name:'Legacy',document:'# Test\n\n## Tasks\n- [ ] One\n\n## 七、确认已了解使用说明\n- [x] 我已阅读《使用说明》\n'});
 const data=S.payload(S.get(id));assert.equal(data.gateDone,true);assert.equal(data.total,1);assert.equal(data.items[0].seq,1);assert.equal(data.items[1].seq,'');assert.equal(data.items[1].gate,true);
});

test('Permission-specific checklist rows follow selected permissions',async()=>{
 const {S,context}=setup();const id=await S.create({name:'Conditional permissions'});const project=S.get(id);
 function texts(selected){project.permissions.selected=selected;const data=S.payload(project);return data.items.filter(i=>context.window.PermissionVisibility.visible(i.permissionRule,selected,vm.runInContext('PAGES_DATA.profiles',context))).map(i=>i.text);}
 assert.equal(texts([]).some(t=>t.includes('READ_MEDIA_IMAGES')),false);
 const camera=texts(['camera']);for(const marker of ['READ_MEDIA_IMAGES','BLUETOOTH_CONNECT','POST_NOTIFICATIONS','ACCESS_BACKGROUND_LOCATION','ATT 声明','设备 ID'])assert.equal(camera.some(t=>t.includes(marker)),false,marker);
 for(const [permission,marker] of [['photos','READ_MEDIA_IMAGES'],['bluetooth','BLUETOOTH_CONNECT'],['notifications','POST_NOTIFICATIONS'],['location_background','ACCESS_BACKGROUND_LOCATION'],['tracking','ATT 声明'],['health','敏感权限']])assert.equal(texts([permission]).some(t=>t.includes(marker)),true,permission);
 for(const selected of [[],['camera'],['tracking'],['notifications']]){project.permissions.selected=selected;const data=S.payload(project);const expected=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',"import json,checklist_tool as c;from pathlib import Path;print(c.document_payload(Path('online/default_checklist.md').read_text(),'test.md',1,(json.loads(__import__('sys').argv[1]),{},{}),{},'1')['total'])",JSON.stringify(selected)],{encoding:'utf8'}));assert.equal(data.total,expected);}
});

test('Legacy account deletion subsection follows account-system feature without changing item identity',async()=>{
 const {S}=setup();const document='# Test\n<!-- FEATURES hasAccountSystem=0 targetMinors=0 -->\n## Privacy\n### 5.4 账号注销与数据主体权利\n- [x] 账号注销入口可达\n- [ ] 注销流程在 App 内完整走完\n### 5.5 iOS 权限声明\n- [ ] 其他核对项\n';
 const original=S.parse(document).items[0].id;const id=await S.create({name:'Legacy account',document});const p=S.get(id),data=S.payload(p);assert.equal(data.items[0].cond,'hasAccountSystem');assert.equal(data.items[1].cond,'hasAccountSystem');assert.equal(data.items[0].id,original);assert.equal(data.items[0].state,'done');assert.equal(data.total,0);
 p.document=p.document.replace('hasAccountSystem=0','hasAccountSystem=1');assert.equal(S.payload(p).total,2);
});

test('Feedback feature defaults off and preserves completed feedback items when toggled',async()=>{
 const {S}=setup();const document='# App\n## Config\n### 3. 用户反馈 → `feedbackApiKey`\n- [x] feedbackApiKey 已替换\n- [ ] 反馈入口可达\n### 4. Other\n- [ ] Other check\n';
 const id=await S.create({name:'Optional feedback',document});const p=S.get(id);let data=S.payload(p);assert.equal(data.features.hasFeedbackSystem,false);assert.equal(data.total,1);const task=data.items[0];assert.equal(task.cond,'hasFeedbackSystem');
 await S.mutate(id,1,'enable feedback',p=>p.document='<!-- FEATURES hasAccountSystem=1 targetMinors=1 hasFeedbackSystem=1 -->\n'+p.document);data=S.payload(S.get(id));assert.equal(data.total,3);assert.equal(data.items[0].id,task.id);assert.equal(data.items[0].state,'done');
});

test('Fixed task and section IDs survive wording changes and match Python',async()=>{
 const {S}=setup();const raw='# App\n## Group\n### Details\n- [x] Original task\n';const before=S.parse(raw),fixed=S.stabilize(raw);const edited=fixed.replace('Group','Renamed group').replace('Original task','Revised task');const after=S.parse(edited);assert.equal(after.items[0].id,before.items[0].id);assert.equal(after.sections[0].id,before.sections[0].id);assert.equal(after.items[0].state,'done');
 const python=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c','import json,sys,checklist_tool as c;print(json.dumps(c.parse_md(sys.argv[1])))',edited],{encoding:'utf8'}));assert.equal(python.items[0].id,after.items[0].id);assert.equal(python.sections[0].id,after.sections[0].id);
});
test('Legacy migration keeps states and review identities with a complete pre-upgrade snapshot',async()=>{
 const {S,context}=setup();const raw='# Old\n## Tasks\n- [x] Original\n';const id='legacy',task=S.parse(raw).items[0];
 context.localStorage.setItem(S.KEY,JSON.stringify({schema:1,projects:{[id]:{id,name:'Old',document:raw,permissions:{selected:[],descs:{},descsEn:{}},review:{release:{version:'1'},items:{[task.id]:{notes:'keep'}},history:[]},version:3,generation:1,snapshots:[],createdAt:1,updatedAt:1}}}));
 const result=await S.initialize();assert.equal(result.migrated,1);const p=S.get(id);assert.equal(p.version,3);assert.equal(S.parse(p.document).items[0].id,task.id);assert.equal(p.review.items[task.id].notes,'keep');assert.equal(p.snapshots[0].state.document,raw);assert.equal(p.dataVersion,2);
});
test('Workspace backup restores multiple projects, snapshots and browser drafts without overwriting',async()=>{
 const source=setup(),id=await source.S.create({name:'One'});await source.S.create({name:'Two'});await source.S.mutate(id,1,'note',p=>p.review.release.version='2');source.context.localStorage.setItem('app-release-checklist-state-v2:pages:'+id,JSON.stringify({state:{draft:'done'},revision:'2',__gen:1}));
 const bundle=source.S.exportAll(),target=setup();await target.S.create({name:'Existing'});const imported=await target.S.importAll(bundle);assert.equal(target.S.list().length,3);assert.equal(imported.ids.length,2);const p=target.S.get(imported.ids[0]);assert.equal(p.review.release.version,'2');assert.equal(p.snapshots.length,1);assert.equal(p.snapshots[0].state.id,p.id);assert.equal(JSON.parse(target.context.localStorage.getItem('app-release-checklist-state-v2:pages:'+p.id)).revision,'1');
 const bad=JSON.parse(JSON.stringify(bundle));bad.projects.push({document:'invalid'});await assert.rejects(target.S.importAll(bad));const orphanDraft=JSON.parse(JSON.stringify(bundle));orphanDraft.drafts.unknown={state:{}};assert.throws(()=>target.S.inspectImportAll(orphanDraft),/没有对应项目/);const invalidDraft=JSON.parse(JSON.stringify(bundle));invalidDraft.drafts[id].state.draft='unknown';assert.throws(()=>target.S.inspectImportAll(invalidDraft),/检查状态无效/);assert.equal(target.S.list().length,3);
});
test('GitHub workspace merge preserves stable project IDs, local projects, and conflict snapshots',async()=>{
 const source=setup(),same=await source.S.create({name:'Shared'}),cloudOnly=await source.S.create({name:'Cloud only'});await source.S.mutate(same,1,'cloud update',p=>{p.name='Cloud shared';p.review.release.version='cloud';});
 source.context.localStorage.setItem('app-release-checklist-state-v2:pages:'+cloudOnly,JSON.stringify({state:{},revision:'1',__gen:1}));
 const bundle=source.S.exportAll(),local=setup();let existing=await local.S.create({name:'Shared'});const localData=JSON.parse(local.context.localStorage.getItem(local.S.KEY)),localProject=localData.projects[existing];delete localData.projects[existing];localProject.id=same;localData.projects[same]=localProject;local.context.localStorage.setItem(local.S.KEY,JSON.stringify(localData));existing=same;const localOnly=await local.S.create({name:'Local only'});await local.S.mutate(existing,1,'local update',p=>{p.name='Local shared';p.review.release.version='local';});
 const localDraftId=local.S.parse(local.S.get(existing).document).items[0].id;local.context.localStorage.setItem('app-release-checklist-state-v2:pages:'+existing,JSON.stringify({state:{[localDraftId]:'done'},revision:'2',__gen:1}));
 const result=await local.S.mergeRemoteAll(bundle),projects=local.S.list(),merged=local.S.get(existing),added=projects.find(p=>p.name==='Cloud only');
 assert.equal(result.added,1);assert.equal(result.updated,1);assert.equal(result.localOnly,1);assert.equal(merged.name,'Cloud shared');assert.equal(merged.snapshots[0].label,'GitHub 同步前保留的本机版本');assert.equal(added.id,cloudOnly);assert.ok(local.S.get(localOnly));assert.ok(added.snapshots.every(snapshot=>snapshot.state.id===added.id));
 assert.equal(JSON.parse(local.context.localStorage.getItem('app-release-checklist-state-v2:pages:'+existing)).state[localDraftId],'done');
 const remoteDraft=JSON.parse(local.context.localStorage.getItem('app-release-checklist-state-v2:pages:'+added.id));assert.ok(remoteDraft);assert.equal(remoteDraft.__gen,added.generation);
});
test('Unreadable browser drafts remain in backups and are reported instead of silently omitted',async()=>{
 const source=setup(),id=await source.S.create({name:'Damaged draft'});source.context.localStorage.setItem('app-release-checklist-state-v2:pages:'+id,'{broken');const bundle=source.S.exportAll();assert.equal(source.S.inspectImportAll(bundle).unreadableDrafts,1);const target=setup(),result=await target.S.importAll(bundle);assert.equal(result.draftError,true);assert.equal(target.S.list().length,1);
});
test('New release archives completed state, retains chosen notes, clears evidence and checks atomically',async()=>{
 const {S,context}=setup();const id=await S.create({name:'Release'});const item=S.payload(S.get(id)).items.find(i=>!i.gate);await S.mutate(id,1,'prepare',p=>{p.document=S.apply(p.document,{[item.id]:'done'});p.review={release:{version:'1'},items:{[item.id]:{notes:'keep',evidence:'remove.png'}},history:[]};});context.location.search='?id='+id;context.window.fetch=async()=>{};S.install();
 const response=await context.window.fetch('/api/new-release',{method:'POST',body:JSON.stringify({revision:'2',release:{version:'2'},keepNotes:true,keepEvidence:false})});assert.equal(response.status,200);const p=S.get(id);assert.equal(p.review.history[0].release.version,'1');assert.equal(p.review.history[0].items.find(x=>x.id===item.id).state,'done');assert.equal(p.review.release.version,'2');assert.equal(p.review.items[item.id].notes,'keep');assert.equal(p.review.items[item.id].evidence,undefined);assert.equal(S.payload(p).items.find(x=>x.id===item.id).state,'todo');assert.equal(p.generation,2);
});
test('Template update preserves modified built-in text, custom tasks and notes',async()=>{
 const {S}=setup();const id=await S.create({name:'Template'});const before=S.get(id),item=S.parse(before.document).items[0];await S.mutate(id,1,'custom edit',p=>{p.document=p.document.replace(item.text,'My custom wording')+'\n## Custom\n- [x] My custom task\n';p.review.items[item.id]={notes:'keep'};});await S.updateTemplate(id,2);const p=S.get(id);assert.match(p.document,/My custom wording/);assert.match(p.document,/My custom task/);assert.equal(p.review.items[item.id].notes,'keep');assert.ok(p.snapshots.length>=2);
});

test('Historical pull advances revisions and rejects stale pages',async()=>{
 const {S}=setup(),id=await S.create({name:'Original'}),old=S.exportAll();
 await S.mutate(id,1,'edit',p=>p.name='New');await S.mergeRemoteAll(old);
 assert.equal(S.get(id).name,'Original');assert.equal(S.get(id).version,3);assert.equal(S.get(id).generation,2);
 await assert.rejects(S.mutate(id,1,'stale',p=>p.name='Overwrite'),/另一个页面/);
 await assert.rejects(S.mutate(id,2,'stale',p=>p.name='Overwrite'),/另一个页面/);
});
test('Pull confirmation detects edits, drafts, additions and deletions atomically',async()=>{
 for(const change of ['edit','draft','add','delete']){const {S,context}=setup(),id=await S.create({name:'Before'}),remote=S.exportAll(),token=S.workspaceToken();
 if(change==='edit')await S.mutate(id,1,'edit',p=>p.name='After');
 if(change==='draft')context.localStorage.setItem('app-release-checklist-state-v2:pages:'+id,JSON.stringify({state:{one:'done'}}));
 if(change==='add')await S.create({name:'Added'});if(change==='delete')await S.remove(id);
 const before=S.workspaceToken();await assert.rejects(S.mergeRemoteAll(remote,token),e=>e.status===409);assert.equal(S.workspaceToken(),before);
 }
});
test('Untrusted project IDs and invalid revisions are rejected before writes',async()=>{
 const {S}=setup();await S.create({name:'Safe'});const original=S.workspaceToken();
 for(const id of ['x" onmouseover="alert(1)','__proto__','constructor','prototype','../file','a b']){const bundle=S.exportAll();bundle.projects[0].id=id;assert.throws(()=>S.inspectImportAll(bundle),/项目 ID/);await assert.rejects(S.mergeRemoteAll(bundle));}
 for(const version of [0,-1,'1',null,Number.MAX_SAFE_INTEGER]){const bundle=S.exportAll();bundle.projects[0].version=version;assert.throws(()=>S.inspectImportAll(bundle),/版本/);}
 assert.equal(S.workspaceToken(),original);
});
test('No-op saves skip snapshots, revisions and storage writes',async()=>{
 const {S,block}=setup(),id=await S.create({name:'Same'});block();await S.mutate(id,1,'noop',()=>{});assert.equal(S.get(id).version,1);assert.equal(S.get(id).snapshots.length,0);
});
test('Cached parses remain isolated and preserve section item identity',()=>{
 const {S}=setup(),text='# Test\n## Tasks\n- [ ] One';const first=S.parse(text);first.items[0].state='done';const next=S.parse(text);assert.equal(next.items[0].state,'todo');assert.equal(next.sections[0].blocks[0],next.items[0]);
});
function syncSetup(){const result=setup(),{S,context}=result;context.PagesStore=S;context.document={getElementById:()=>null,readyState:'loading',addEventListener:()=>{}};
 const source=fs.readFileSync('pages/github-sync.js','utf8').replace("if(document.readyState==='loading')", "window.syncTest={mergedForUpload,diff,diffHtml};if(document.readyState==='loading')");vm.runInContext(source,context);return {...result,sync:context.window.syncTest};}
test('Upload merges snapshots even when project contents match, deduplicates and retains newest ten',async()=>{
 const {S,sync}=syncSetup(),id=await S.create({name:'Same'}),local=S.exportAll(),remote=S.exportAll(),state=JSON.parse(JSON.stringify(local.projects[0]));delete state.snapshots;
 local.projects[0].snapshots=[{id:'local',date:20,state}];remote.projects[0].snapshots=[{id:'remote',date:10,state}];
 const merged=sync.mergedForUpload(local,remote);assert.deepEqual(Array.from(merged.projects[0].snapshots,x=>x.id),['local','remote']);
 const snapshots=Array.from({length:15},(_,i)=>({id:'s'+i,date:i,state}));assert.equal(S.mergeSnapshots(snapshots,snapshots).length,10);assert.equal(S.mergeSnapshots(snapshots,snapshots)[0].id,'s14');
});
test('Pull preview describes cloud conflict choice and actual draft policy',async()=>{
 const {S,sync}=syncSetup();await S.create({name:'Local'});const local=S.exportAll(),remote=S.exportAll();remote.projects[0].name='Cloud';const html=sync.diffHtml(sync.diff(local,remote),'','pull');assert.match(html,/采用所选云端版本/);assert.doesNotMatch(html,/采用本机版本/);assert.match(html,/保留本机版本/);
});


test('Subscription setting persists, hides checks and retains progress and notes',async()=>{
 const {S,context}=setup();const id=await S.create({name:'Subscriptions'});const initial=S.payload(S.get(id));assert.equal(initial.features.hasSubscriptions,true);
 const tasks=initial.items.filter(i=>i.cond==='hasSubscriptions');assert.ok(tasks.length>30);const task=tasks[0];
 await S.mutate(id,1,'progress',p=>{p.document=S.apply(p.document,{[task.id]:'done'});p.review.items[task.id]={notes:'Keep evidence'};});
 context.location.search='?id='+id;context.window.fetch=async()=>{throw Error('Unexpected network');};S.install();
 for(const enabled of [false,true]){
  const project=S.get(id);const response=await context.window.fetch('/api/features',{method:'POST',body:JSON.stringify({revision:String(project.version),features:{...S.payload(project).features,hasSubscriptions:enabled}})});assert.equal(response.status,200);
  const saved=S.get(id),data=S.payload(saved);assert.equal(data.features.hasSubscriptions,enabled);assert.equal(data.total,initial.total-(enabled?0:tasks.length));assert.equal(data.items.find(i=>i.id===task.id).state,'done');assert.equal(saved.review.items[task.id].notes,'Keep evidence');
 }
});

test('Subscription catalogue survives export, import, snapshots and release archive',async()=>{
 const {S,context}=setup();const id=await S.create({name:'Catalogue'});const products=[{id:'weekly',name:'周订阅',period:'week',price:'18.50',currency:'CNY',offerPrice:'6.00',offerCycles:'3'}];
 await S.mutate(id,1,'catalogue',p=>p.review.subscriptions=products);
 const imported=await S.create({...S.export(id),name:'Imported catalogue'});assert.deepEqual(JSON.parse(JSON.stringify(S.get(imported).review.subscriptions)),products);
 context.location.search='?id='+id;context.window.fetch=async()=>{throw Error('Unexpected network');};S.install();
 const response=await context.window.fetch('/api/new-release',{method:'POST',body:JSON.stringify({revision:'2',release:{version:'2'},keepNotes:true,keepEvidence:true})});assert.equal(response.status,200);
 const saved=S.get(id);assert.deepEqual(JSON.parse(JSON.stringify(saved.review.subscriptions)),products);assert.deepEqual(JSON.parse(JSON.stringify(saved.review.history[0].subscriptions)),products);assert.deepEqual(JSON.parse(JSON.stringify(saved.snapshots[0].state.review.subscriptions)),products);
 await assert.rejects(S.create({...S.export(id),name:'Invalid catalogue',review:{release:{},items:{},history:[],subscriptions:{price:1}}}),/订阅商品/);
});


test('Push feature defaults off and toggles without losing progress, notes or permissions',async()=>{
 const {S,context}=setup();const id=await S.create({name:'Optional push'});let project=S.get(id),data=S.payload(project);assert.equal(data.features.hasPush,false);
 const push=data.items.filter(i=>i.cond==='hasPush');assert.equal(push.length,3);const task=push.find(i=>i.id==='t_c7c9aea7');
 await S.mutate(id,1,'progress',p=>{p.document=S.apply(p.document,{[task.id]:'done'});p.review.items[task.id]={notes:'APNs checked'};p.permissions.selected=['notifications'];});
 context.location.search='?id='+id;context.window.fetch=async()=>{throw Error('Unexpected network');};S.install();
 const offTotal=S.payload(S.get(id)).total;
 for(const enabled of [true,false,true]){project=S.get(id);const response=await context.window.fetch('/api/features',{method:'POST',body:JSON.stringify({revision:String(project.version),features:{...S.payload(project).features,hasPush:enabled}})});assert.equal(response.status,200);project=S.get(id);data=S.payload(project);assert.equal(data.total,offTotal+(enabled?3:0));assert.equal(data.items.find(i=>i.id===task.id).state,'done');assert.equal(project.review.items[task.id].notes,'APNs checked');assert.equal(project.permissions.selected[0],'notifications');}
});

test('Activity records successful changes with dates; no-op and failed writes leave history intact',async()=>{
 const {S,block}=setup();const id=await S.create({name:'Audit'});const task=S.payload(S.get(id)).items.find(i=>!i.gate);
 await S.mutate(id,1,'write',p=>p.document=S.apply(p.document,{[task.id]:'done'}));let project=S.get(id);assert.equal(project.activity.length,1);assert.equal(project.activity[0].label,'保存检查进度');assert.ok(project.activity[0].changes.some(c=>c.includes('待检查 → 已完成')));assert.equal(project.activity[0].date,project.updatedAt);assert.equal(project.snapshots[0].state.activity,undefined);
 await S.mutate(id,2,'write',()=>{});assert.equal(S.get(id).activity.length,1);assert.equal(S.get(id).version,2);
 const exported=S.export(id),imported=await S.create({...exported,name:'Imported audit'});assert.equal(S.get(imported).activity[0].id,project.activity[0].id);
 block();await assert.rejects(S.mutate(id,2,'failed',p=>p.name='Fail'),/未保存/);assert.equal(S.get(id).activity.length,1);assert.equal(S.get(id).version,2);
});
test('Restoring a snapshot retains later activity and preserves the pre-restore state',async()=>{
 const {S}=setup();const id=await S.create({name:'Before'});await S.mutate(id,1,'edit',p=>p.name='After');const snapshot=S.get(id).snapshots[0];await S.mutate(id,2,'restore',p=>{const version=p.version;Object.assign(p,JSON.parse(JSON.stringify(snapshot.state)));p.version=version;p.generation++;});const p=S.get(id);assert.equal(p.name,'Before');assert.equal(p.activity.length,2);assert.equal(p.activity[0].label,'恢复历史快照');assert.equal(p.snapshots[0].state.name,'After');assert.equal(p.snapshots.length,2);
});
test('Activity merge deduplicates and limits retained records',()=>{
 const {S}=setup();const entries=Array.from({length:110},(_,i)=>({id:'event-'+i,date:i,label:'edit',changes:['changed']}));const merged=S.mergeActivity(entries,entries);assert.equal(merged.length,100);assert.equal(merged[0].id,'event-109');assert.equal(new Set(merged.map(e=>e.id)).size,100);
});
