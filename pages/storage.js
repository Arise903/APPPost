/* Durable workspace adapter. Mutations publish only after an IndexedDB commit. */
(function(root){
'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
const validate=data=>{if(!data||data.schema!==1||!data.projects||Array.isArray(data.projects)||typeof data.projects!=='object')throw Error('不支持的本地数据版本');if((data.storageVersion||1)>3)throw Error('本地数据版本较新，请更新网页后再操作');return data;};
function parse(raw){try{return validate(raw?JSON.parse(raw):{schema:1,projects:{}});}catch(error){throw Error('浏览器记录无法读取：'+error.message+'。请先下载存储恢复包。');}}
function open(key){
 const modeKey=key+':storage-mode',signalKey=key+':signal';
 let database,cache=null,initializing=null,backend='loading',migration=null,channel;
 const legacy=()=>!root.indexedDB||localStorage.getItem(modeKey)==='legacy';
 function readLegacy(){const data=parse(localStorage.getItem(key));if((data.storageVersion||1)>=3)throw Error('此工作台已迁移到 IndexedDB，当前不能读取迁移标记作为项目数据。请恢复数据库访问或下载存储恢复包；已停止兼容模式读写。');return data;}

 function announce(){root.dispatchEvent?.(new Event('projectchanged'));try{localStorage.setItem(signalKey,String(Date.now())+Math.random());}catch(_){}channel?.postMessage('changed');}
 function lock(action){if(!navigator.locks)throw Error('此浏览器不支持安全保存，请通过 HTTP/HTTPS 使用支持 Web Locks 的浏览器。');return navigator.locks.request('release-desk-pages-write',action);}
 function openDB(){return new Promise((resolve,reject)=>{const request=root.indexedDB.open('release-desk-workspace',1);request.onupgradeneeded=()=>request.result.createObjectStore('records');request.onerror=()=>reject(Error('无法打开 IndexedDB：'+request.error?.message));request.onblocked=()=>reject(Error('存储升级被其他页面阻止，请关闭旧标签页再重试。'));request.onsuccess=()=>{database=request.result;database.onversionchange=()=>{database.close();database=null;backend='stale';root.dispatchEvent?.(new Event('storageblocked'));};resolve();};});}
 function dbRead(name){return new Promise((resolve,reject)=>{const tx=database.transaction('records','readonly'),request=tx.objectStore('records').get(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
 function dbWrite(entries){return new Promise((resolve,reject)=>{const tx=database.transaction('records','readwrite');tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(Error('保存失败，IndexedDB 事务已回滚：'+(tx.error?.message||'存储不可用或空间不足')));try{for(const [name,value] of entries)tx.objectStore('records').put(value,name);}catch(error){tx.abort();reject(Error('保存失败，IndexedDB 事务已回滚：'+error.message));}});}
 async function start(){
  if(legacy()){const data=readLegacy();backend='localStorage';cache=data;return;}
  await openDB();await lock(async()=>{
   let record=await dbRead(key);const raw=localStorage.getItem(key);let marker=false;try{marker=JSON.parse(raw||'{}').storageVersion===3;}catch(_){}
   if(!record){
    if(marker)throw Error('迁移标记存在但数据库记录丢失，请从离线备份恢复。');
    const original=parse(raw);const value={...original,storageVersion:3};
    migration={raw,date:Date.now()};
    await dbWrite([[key+':migration',migration],[key,{value,epoch:1}]]);
    record=await dbRead(key);if(JSON.stringify(record.value)!==JSON.stringify(value))throw Error('迁移读回校验失败，原始数据已保留。');
   }else{validate(record.value);migration=await dbRead(key+':migration');if(!marker&&raw!==migration?.raw)throw Error('迁移中断期间旧版记录发生变化。请下载存储恢复包，再选择采用旧版数据重新迁移。');}
   // Fence old clients after verified commit. Original bytes stay in IndexedDB.
   try{localStorage.setItem(key,JSON.stringify({schema:1,storageVersion:3,projects:{},migratedAt:Date.now()}));}catch(_){throw Error('无法锁定旧版存储，请允许浏览器存储后重试；迁移备份已保留。');}
   cache=record.value;backend='IndexedDB';
  });
  if(root.BroadcastChannel){channel=new root.BroadcastChannel('release-desk-pages');channel.onmessage=()=>refresh().catch(error=>root.dispatchEvent?.(new CustomEvent('storageerror',{detail:error.message})));}
 }
 function ready(){if(!initializing)initializing=start().then(()=>{root.dispatchEvent?.(new Event('projectchanged'));return {backend};}).catch(error=>{initializing=null;throw error;});return initializing;}
 function read(){if(backend==='localStorage')return clone(readLegacy());if(cache)return clone(cache);if(!root.indexedDB)return clone(readLegacy());throw Error('正在打开本机数据库，请稍候。');}
 async function refresh(){await ready();if(backend==='IndexedDB'){if(legacy())throw Error('存储模式已在另一标签页切换，请刷新页面。');cache=validate((await dbRead(key)).value);}root.dispatchEvent?.(new Event('projectchanged'));}
 async function transaction(action){await ready();return lock(async()=>{if(backend==='stale')throw Error('存储模式已变化，请刷新页面后保存。');
  if(backend==='IndexedDB'&&legacy())throw Error('存储模式已切换，请刷新页面后保存。');
  const record=backend==='IndexedDB'?await dbRead(key):null;
  if(backend==='IndexedDB'&&!record)throw Error('数据库记录不存在，已停止保存。请刷新后从备份恢复。');
  const current=record?validate(record.value):readLegacy();cache=current;
  const before=JSON.stringify(current),data=clone(current),result=action(data);
  if(result&&typeof result.then==='function')throw Error('存储事务中不能执行异步操作');
  const serialized=JSON.stringify(data);if(serialized===before)return result;
  if(backend==='IndexedDB')await dbWrite([[key,{value:data,epoch:(record.epoch||0)+1}]]);
  else{try{localStorage.setItem(key,serialized);}catch(_){throw Error('浏览器空间不足或禁止存储，本次修改未保存。请先导出项目，再整理历史备份。');}}
  cache=data;announce();return result;
 });}
 async function recovery(){if(root.indexedDB&&!database)await openDB();return {format:'release-desk-storage-recovery/v1',date:new Date().toISOString(),legacy:localStorage.getItem(key),migration:database?await dbRead(key+':migration'):null,indexedDB:database?await dbRead(key):null,previous:database?await dbRead(key+':previous'):null,legacyConflict:database?await dbRead(key+':legacy-conflict'):null};}
 async function adoptLegacy(){if(!database)await openDB();return lock(async()=>{const raw=localStorage.getItem(key),value=parse(raw);if(value.storageVersion===3)throw Error('当前旧版存储只有迁移标记，不能覆盖数据库。');await dbWrite([[key+':previous',await dbRead(key)],[key+':migration',{raw,date:Date.now()}],[key,{value:{...value,storageVersion:3},epoch:1}]]);localStorage.removeItem(modeKey);});}
 async function adoptIndexedDB(){if(!database)await openDB();await lock(async()=>{const record=await dbRead(key);if(!record)throw Error('数据库记录不存在，请导入离线备份');validate(record.value);await dbWrite([[key+':legacy-conflict',{raw:localStorage.getItem(key),date:Date.now()}]]);localStorage.setItem(key,JSON.stringify({schema:1,storageVersion:3,projects:{}}));localStorage.removeItem(modeKey);cache=record.value;backend='IndexedDB';});initializing=null;}
 async function rollback(){await ready();return lock(async()=>{const record=await dbRead(key);const value={...record.value,storageVersion:2},original=localStorage.getItem(key),originalMode=localStorage.getItem(modeKey);try{localStorage.setItem(key,JSON.stringify(value));localStorage.setItem(modeKey,'legacy');}catch(_){try{if(original===null)localStorage.removeItem(key);else localStorage.setItem(key,original);if(originalMode===null)localStorage.removeItem(modeKey);else localStorage.setItem(modeKey,originalMode);}catch(_){}throw Error('旧版存储容量不足，未切换。请保留 IndexedDB 并导出备份。');}backend='stale';channel?.postMessage('changed');});}
 async function migrate(){if(localStorage.getItem(modeKey)!=='legacy')return ready();if(!database)await openDB();await adoptLegacy();initializing=null;return ready();}
 function usage(){const data=read();return {backend,bytes:JSON.stringify(data).length*2,projects:Object.keys(data.projects).length,snapshots:Object.values(data.projects).reduce((n,p)=>n+(p.snapshots||[]).length,0)};}
 root.addEventListener?.('storage',event=>{if([signalKey,key,modeKey].includes(event.key)&&cache)refresh().catch(error=>root.dispatchEvent?.(new CustomEvent('storageerror',{detail:error.message})));});
 return {read,readProject:id=>backend==='IndexedDB'&&cache?clone(cache.projects[id]||null):read().projects[id],ready,refresh,transaction,usage,recovery,adoptLegacy,adoptIndexedDB,rollback,migrate};
}
root.PagesStorage={open};
})(window);
