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
