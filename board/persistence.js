let saveQueue=Promise.resolve(), queuedWrites=0;
function api(path,body){
 const writing=body!==undefined&&!['/api/backups','/api/perm-config','/api/perm-en-preview','/api/perm-write-en'].includes(path);
 if(!writing)return apiRequest(path,body);
 queuedWrites++;updateSaveStatus();
 const observedRevision=baseRevision;
 const result=saveQueue.catch(()=>{}).then(()=>apiRequest(path,{...body,revision:body.revision===undefined||body.revision===observedRevision?baseRevision:body.revision}));
 saveQueue=result.finally(()=>{queuedWrites--;setTimeout(updateSaveStatus,0);});saveQueue.catch(()=>{});return result;
}
async function apiRequest(path, body){
  const writing = body !== undefined && !["/api/profiles", "/api/backups", "/api/perm-config", "/api/perm-en-preview", "/api/perm-write-en"].includes(path);
  if(writing){ savingOperations++; saveFailure=""; updateSaveStatus(); }
  try{
  const opt = body === undefined ? {} : {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(Object.assign({revision:baseRevision}, body))
  };
  const r = await boardFetch(path, opt);
  if(!r.ok){ const err = await r.json().catch(() => ({})); throw new Error(err.error || (path + " -> HTTP " + r.status)); }
  const data = await r.json();
  if(body !== undefined && data.revision){ baseRevision = data.revision; saveState(); }
  if(writing){lastSavedAt=Date.now();if(typeof clearFailedWrite==='function')clearFailedWrite(path);}
  return data;
  }catch(error){ if(writing){saveFailure=error.message;if(typeof rememberFailedWrite==='function')rememberFailedWrite(path,body,error);} throw error; }
  finally{ if(writing) savingOperations--; setTimeout(updateSaveStatus,0); }
}
