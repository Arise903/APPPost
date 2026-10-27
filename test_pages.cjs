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
