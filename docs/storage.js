/* Workspace metadata, projects and asset bodies commit atomically in separate stores. */
(function(root){
'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
const omit=(value,key)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));
const assetCopy=assets=>Object.fromEntries(Object.entries(assets||{}).map(([id,asset])=>[id,{...asset}]));
const projectCopy=project=>project?{...clone(omit(project,'assets')),...('assets' in project?{assets:assetCopy(project.assets)}:{})}:null;
const workspaceCopy=data=>({...clone(omit(data,'projects')),projects:Object.fromEntries(Object.entries(data.projects).map(([id,p])=>[id,projectCopy(p)]))});
const sameAsset=(a,b)=>!!a&&!!b&&a.data===b.data&&JSON.stringify(omit(a,'data'))===JSON.stringify(omit(b,'data'));
const sameProject=(a,b)=>!!a&&!!b&&JSON.stringify(omit(a,'assets'))===JSON.stringify(omit(b,'assets'))&&Object.keys(a.assets||{}).length===Object.keys(b.assets||{}).length&&Object.entries(a.assets||{}).every(([id,asset])=>sameAsset(asset,b.assets?.[id]));
const validate=data=>{if(!data||data.schema!==1||!data.projects||Array.isArray(data.projects)||typeof data.projects!=='object')throw Error('不支持的本地数据版本');if((data.storageVersion||1)>4)throw Error('本地数据版本较新，请更新网页后再操作');return data;};
function parse(raw){try{return validate(raw?JSON.parse(raw):{schema:1,projects:{}});}catch(error){throw Error('浏览器记录无法读取：'+error.message+'。请先下载存储恢复包。');}}
function open(key){
 const modeKey=key+':storage-mode',signalKey=key+':signal',metaKey=key+':meta';
 let database,cache=null,cacheEpoch=0,initializing=null,backend='loading',channel;
 const legacy=()=>!root.indexedDB||localStorage.getItem(modeKey)==='legacy';
 const projectKey=id=>key+':project:'+id,assetKey=(id,assetId)=>key+':asset:'+id+':'+assetId;
 function readLegacy(){const data=parse(localStorage.getItem(key));if((data.storageVersion||1)>=3)throw Error('此工作台已迁移到 IndexedDB，当前不能读取迁移标记作为项目数据。请恢复数据库访问或下载存储恢复包；已停止兼容模式读写。');return data;}
 function lock(action){if(!navigator.locks)throw Error('此浏览器不支持安全保存，请通过 HTTP/HTTPS 使用支持 Web Locks 的浏览器。');return navigator.locks.request('release-desk-pages-write',action);}
 function announce(){root.dispatchEvent?.(new Event('projectchanged'));try{localStorage.setItem(signalKey,String(Date.now())+Math.random());}catch(_){}channel?.postMessage('changed');}
 function openDB(){if(database)return Promise.resolve();return new Promise((resolve,reject)=>{const request=root.indexedDB.open('release-desk-workspace',2);request.onupgradeneeded=()=>{for(const name of ['records','projects','assets'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};request.onerror=()=>reject(Error('无法打开 IndexedDB：'+request.error?.message));request.onblocked=()=>reject(Error('存储升级被其他页面阻止，请关闭旧标签页再重试。'));request.onsuccess=()=>{database=request.result;database.onversionchange=()=>{database.close();database=null;backend='stale';root.dispatchEvent?.(new Event('storageblocked'));};resolve();};});}
 function dbRead(name){return new Promise((resolve,reject)=>{const tx=database.transaction('records','readonly'),request=tx.objectStore('records').get(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
 function write(operations){return new Promise((resolve,reject)=>{const tx=database.transaction([...new Set(operations.map(op=>op.store))],'readwrite');tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(Error('保存失败，数据库事务已回滚：'+(tx.error?.message||'存储不可用或空间不足')));try{for(const op of operations){const store=tx.objectStore(op.store);if(op.remove)store.delete(op.key);else store.put(op.value,op.key);}}catch(error){tx.abort();reject(Error('保存失败，数据库事务已回滚：'+error.message));}});}
 const put=(store,key,value)=>({store,key,value});
 function projectOperations(id,before,after){
  const ops=[];
  if(!after){ops.push({store:'projects',key:projectKey(id),remove:true});for(const assetId of Object.keys(before?.assets||{}))ops.push({store:'assets',key:assetKey(id,assetId),remove:true});return ops;}
  const refs=Object.fromEntries(Object.entries(after.assets||{}).map(([assetId,a])=>[assetId,{sha256:a.sha256,size:a.size}]));
  ops.push(put('projects',projectKey(id),{value:omit(after,'assets'),hasAssets:'assets' in after,assetRefs:refs}));
  for(const [assetId,asset] of Object.entries(after.assets||{}))if(!sameAsset(asset,before?.assets?.[assetId]))ops.push(put('assets',assetKey(id,assetId),asset));
  for(const assetId of Object.keys(before?.assets||{}))if(!(assetId in (after.assets||{})))ops.push({store:'assets',key:assetKey(id,assetId),remove:true});
  return ops;
 }
 function readSnapshot(projectId){return new Promise((resolve,reject)=>{
  const tx=database.transaction(['records','projects','assets'],'readonly');let record,meta,projects={},failed;
  const fail=error=>{failed=error;tx.abort();};
  tx.onabort=tx.onerror=()=>reject(failed||Error('无法读取项目数据库：'+(tx.error?.message||'读取中断')));
  tx.oncomplete=()=>{if(!record){resolve({record:null,data:null});return;}if(record.value){resolve({record,data:validate(record.value)});return;}try{resolve({record,data:validate({...meta,projects})});}catch(error){reject(error);}};
  const request=tx.objectStore('records').get(key);request.onsuccess=()=>{
   record=request.result;if(!record||record.value)return;if(record.layout!=='split-v1'){fail(Error('未知存储布局，请更新网页'));return;}
   const metadata=tx.objectStore('records').get(metaKey);metadata.onsuccess=()=>{meta=metadata.result;};
   const ids=projectId===undefined?record.projectIds:record.projectIds.filter(id=>id===projectId);
   for(const id of ids){const get=tx.objectStore('projects').get(projectKey(id));get.onsuccess=()=>{
    const stored=get.result;if(!stored){fail(Error('项目记录缺失，请下载恢复包'));return;}
    const project={...stored.value,...(stored.hasAssets?{assets:{}}:{})};projects[id]=project;
    for(const [assetId,ref] of Object.entries(stored.assetRefs||{})){
     const existing=cache?.projects?.[id]?.assets?.[assetId];
     if(existing&&existing.sha256===ref.sha256&&existing.size===ref.size){project.assets=project.assets||{};project.assets[assetId]=existing;continue;}
     const getAsset=tx.objectStore('assets').get(assetKey(id,assetId));getAsset.onsuccess=()=>{if(!getAsset.result){fail(Error('附件内容缺失，已停止保存。请下载恢复包并从备份恢复。'));return;}project.assets=project.assets||{};project.assets[assetId]=getAsset.result;};
    }
   };}
  };
 });}
 async function normalize(record,extra=[]){
  const original=validate(record.value),value={...original,storageVersion:4},ops=[...extra,put('records',key+':before-split',record),put('records',metaKey,omit(value,'projects'))];
  for(const [id,project] of Object.entries(value.projects))ops.push(...projectOperations(id,null,project));
  const header={layout:'split-v1',epoch:(record.epoch||0)+1,projectIds:Object.keys(value.projects)};ops.push(put('records',key,header));await write(ops);
  const restored=await readSnapshot();
  if(JSON.stringify(omit(value,'projects'))!==JSON.stringify(omit(restored.data,'projects'))||Object.keys(value.projects).length!==Object.keys(restored.data.projects).length||Object.entries(value.projects).some(([id,p])=>!sameProject(p,restored.data.projects[id])))throw Error('存储拆分读回校验失败，原记录保留在恢复包中。');
  return restored;
 }
 function fence(){localStorage.setItem(key,JSON.stringify({schema:1,storageVersion:4,projects:{},migratedAt:Date.now()}));}
 async function start(){
  if(legacy()){cache=readLegacy();backend='localStorage';return;}
  await openDB();await lock(async()=>{
   let record=await dbRead(key);const raw=localStorage.getItem(key);let marker=false;try{marker=JSON.parse(raw||'{}').storageVersion>=3;}catch(_){}
   if(!record){if(marker)throw Error('迁移标记存在但数据库记录丢失，请从离线备份恢复。');record={value:parse(raw),epoch:0};const restored=await normalize(record,[put('records',key+':migration',{raw,date:Date.now()})]);cache=restored.data;cacheEpoch=restored.record.epoch;}
   else{const migration=await dbRead(key+':migration');if(!marker&&raw!==migration?.raw)throw Error('迁移中断期间旧版记录发生变化。请下载存储恢复包，再选择采用旧版数据重新迁移。');const restored=record.value?await normalize(record):await readSnapshot();cache=restored.data;cacheEpoch=restored.record.epoch;}
   try{fence();}catch(_){cache=null;throw Error('无法锁定旧版存储，请允许浏览器存储后重试；迁移备份已保留。');}
   backend='IndexedDB';
  });
  if(!channel&&root.BroadcastChannel){channel=new root.BroadcastChannel('release-desk-pages');channel.onmessage=()=>refresh().catch(error=>root.dispatchEvent?.(new CustomEvent('storageerror',{detail:error.message})));}
 }
 function ready(){if(!initializing)initializing=start().then(()=>{root.dispatchEvent?.(new Event('projectchanged'));return {backend};}).catch(error=>{initializing=null;throw error;});return initializing;}
 function read(){if(backend==='localStorage')return workspaceCopy(readLegacy());if(cache)return workspaceCopy(cache);if(!root.indexedDB)return workspaceCopy(readLegacy());throw Error('正在打开本机数据库，请稍候。');}
 function checkWritable(){if(backend==='stale'||backend==='IndexedDB'&&legacy())throw Error('存储模式已变化，请刷新页面后保存。');}
 async function refresh(){await ready();if(backend==='IndexedDB'){checkWritable();const snapshot=await readSnapshot();if(!snapshot.record)throw Error('数据库记录不存在，请恢复备份');cache=snapshot.data;cacheEpoch=snapshot.record.epoch;}root.dispatchEvent?.(new Event('projectchanged'));}
 async function transaction(action){await ready();return lock(async()=>{
  checkWritable();const snapshot=backend==='IndexedDB'?await readSnapshot():{data:readLegacy()};if(!snapshot.data)throw Error('数据库记录不存在，已停止保存。请刷新后从备份恢复。');cache=snapshot.data;
  const data=workspaceCopy(cache),result=action(data);if(result&&typeof result.then==='function')throw Error('存储事务中不能执行异步操作');
  if(backend==='localStorage'){const changed=JSON.stringify(omit(data,'projects'))!==JSON.stringify(omit(cache,'projects'))||Object.keys(data.projects).length!==Object.keys(cache.projects).length||Object.entries(data.projects).some(([id,p])=>!sameProject(p,cache.projects[id]));if(changed){try{localStorage.setItem(key,JSON.stringify(data));}catch(_){throw Error('浏览器空间不足或禁止存储，本次修改未保存。请先导出项目，再整理历史备份。');}cache=data;announce();}return result;}
  const ops=[],metadataChanged=JSON.stringify(omit(data,'projects'))!==JSON.stringify(omit(cache,'projects'));
  for(const id of new Set([...Object.keys(cache.projects),...Object.keys(data.projects)]))if(!sameProject(cache.projects[id],data.projects[id]))ops.push(...projectOperations(id,cache.projects[id],data.projects[id]));
  if(!ops.length&&!metadataChanged)return result;
  if(metadataChanged)ops.push(put('records',metaKey,omit(data,'projects')));
  const header={layout:'split-v1',epoch:snapshot.record.epoch+1,projectIds:Object.keys(data.projects)};ops.push(put('records',key,header));await write(ops);cache=data;cacheEpoch=header.epoch;announce();return result;
 });}
 async function projectTransaction(id,action){await ready();if(backend!=='IndexedDB')return transaction(action);return lock(async()=>{
  checkWritable();const header=await dbRead(key);if(!header||header.layout!=='split-v1')throw Error('数据库记录不存在或已变化，请刷新页面');
  if(cacheEpoch!==header.epoch){const latest=await readSnapshot();cache=latest.data;cacheEpoch=latest.record.epoch;}
  const snapshot=await readSnapshot(id),before=snapshot.data.projects[id],data={projects:{[id]:projectCopy(before)}},result=action(data);
  if(result&&typeof result.then==='function')throw Error('存储事务中不能执行异步操作');const after=data.projects[id];if(sameProject(before,after))return result;
  const ops=projectOperations(id,before,after),next={...header,epoch:header.epoch+1};ops.push(put('records',key,next));await write(ops);cache={...cache,projects:{...cache.projects,[id]:after}};cacheEpoch=next.epoch;announce();return result;
 });}
 async function recovery(){if(root.indexedDB&&!database)await openDB();const snapshot=database?await readSnapshot():null;return {format:'release-desk-storage-recovery/v1',date:new Date().toISOString(),legacy:localStorage.getItem(key),migration:database?await dbRead(key+':migration'):null,indexedDB:snapshot?.record?{value:snapshot.data,epoch:snapshot.record.epoch}:null,beforeSplit:database?await dbRead(key+':before-split'):null,previous:database?await dbRead(key+':previous'):null,legacyConflict:database?await dbRead(key+':legacy-conflict'):null};}
 async function adoptLegacy(){await openDB();return lock(async()=>{const raw=localStorage.getItem(key),value=readLegacy(),previous=await readSnapshot();await normalize({value,epoch:previous.record?.epoch||0},[put('records',key+':previous',{value:previous.data,epoch:previous.record?.epoch}),put('records',key+':migration',{raw,date:Date.now()})]);localStorage.removeItem(modeKey);});}
 async function adoptIndexedDB(){await openDB();await lock(async()=>{let snapshot=await readSnapshot();if(!snapshot.record)throw Error('数据库记录不存在，请导入离线备份');if(snapshot.record.value)snapshot=await normalize(snapshot.record);validate(snapshot.data);await write([put('records',key+':legacy-conflict',{raw:localStorage.getItem(key),date:Date.now()})]);fence();localStorage.removeItem(modeKey);cache=snapshot.data;cacheEpoch=snapshot.record.epoch;backend='IndexedDB';});initializing=null;}
 async function rollback(){await ready();return lock(async()=>{const snapshot=await readSnapshot(),value={...snapshot.data,storageVersion:2},original=localStorage.getItem(key),originalMode=localStorage.getItem(modeKey);try{localStorage.setItem(key,JSON.stringify(value));localStorage.setItem(modeKey,'legacy');}catch(_){try{if(original===null)localStorage.removeItem(key);else localStorage.setItem(key,original);if(originalMode===null)localStorage.removeItem(modeKey);else localStorage.setItem(modeKey,originalMode);}catch(_){}throw Error('旧版存储容量不足，未切换。请保留 IndexedDB 并导出备份。');}backend='stale';channel?.postMessage('changed');});}
 async function migrate(){if(localStorage.getItem(modeKey)!=='legacy')return ready();await adoptLegacy();initializing=null;return ready();}
 function usage(){const data=backend==='localStorage'?readLegacy():cache;if(!data)throw Error('正在打开本机数据库');let bytes=JSON.stringify(omit(data,'projects')).length*2;for(const p of Object.values(data.projects)){bytes+=JSON.stringify(omit(p,'assets')).length*2;for(const asset of Object.values(p.assets||{}))bytes+=asset.data.length*2+JSON.stringify(omit(asset,'data')).length*2;}return {backend,layout:backend==='IndexedDB'?'split-v1':'legacy',bytes,projects:Object.keys(data.projects).length,snapshots:Object.values(data.projects).reduce((n,p)=>n+(p.snapshots||[]).length,0)};}
 root.addEventListener?.('storage',event=>{if([signalKey,key,modeKey].includes(event.key)&&cache)refresh().catch(error=>root.dispatchEvent?.(new CustomEvent('storageerror',{detail:error.message})));});
 return {read,readProject:id=>projectCopy((backend==='localStorage'?readLegacy():cache)?.projects[id]),ready,refresh,transaction,projectTransaction,usage,recovery,adoptLegacy,adoptIndexedDB,rollback,migrate};
}
root.PagesStorage={open};
})(window);
