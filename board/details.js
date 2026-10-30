/* Item evidence stays in the same draft and commit as notes and exceptions. */
function detailAttachmentIds(){try{const value=JSON.parse(document.getElementById('itemReviewForm').elements.attachmentIds.value||'[]');return Array.isArray(value)?value:[];}catch(_){return [];}}
function renderItemAttachments(){
 const list=document.getElementById('itemAttachments');list.replaceChildren();const ids=detailAttachmentIds();document.getElementById('itemEvidenceCount').textContent=ids.length?ids.length+' 个附件':'';
 for(const id of ids){const file=reviewData.evidenceFiles?.[id],row=document.createElement('div');row.className='detail-attachment';const name=document.createElement('span');name.textContent=file?file.name+(file.expiresAt?' · 至 '+file.expiresAt:''):'附件记录缺失';row.append(name);
  if(window.RELEASE_PAGES&&file){const download=document.createElement('button');download.type='button';download.className='btn';download.textContent='下载';download.onclick=async()=>{try{const asset=PagesStore.get(PagesStore.projectId()).assets?.[file.assetId];if(!asset)throw Error('附件内容缺失，请从备份恢复');await PagesStore.verifyAssets({[file.assetId]:asset});PagesStore.download(file.name,Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)),'application/octet-stream');}catch(error){document.getElementById('itemReviewError').textContent=error.message;}};row.append(download);}
  const unlink=document.createElement('button');unlink.type='button';unlink.className='btn';unlink.textContent='解除关联';unlink.onclick=()=>{document.getElementById('itemReviewForm').elements.attachmentIds.value=JSON.stringify(detailAttachmentIds().filter(value=>value!==id));renderItemAttachments();updateSaveStatus();};row.append(unlink);list.append(row);
 }
 document.getElementById('itemAttachmentPicker').hidden=!window.RELEASE_PAGES;
}
async function prepareItemAttachments(next,itemId){
 const files=[...document.getElementById('itemAttachmentUpload').files],assets={};if(!files.length)return assets;
 if(!window.RELEASE_PAGES)throw Error('文件附件请使用个人工作台');next.evidenceFiles=next.evidenceFiles||{};
 for(const file of files){if(file.size>5*1024*1024)throw Error(file.name+' 超过 5 MiB');const bytes=new Uint8Array(await file.arrayBuffer()),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const assetId='asset_'+sha256,id=crypto.randomUUID();assets[assetId]={id:assetId,data:btoa(binary),size:file.size,sha256};next.evidenceFiles[id]={id,assetId,name:file.name.slice(0,200),mime:file.type||'application/octet-stream',taskIds:[itemId],expiresAt:next.items[itemId].evidenceExpiresAt||'',date:new Date().toISOString()};next.items[itemId].attachmentIds=JSON.stringify([...JSON.parse(next.items[itemId].attachmentIds||'[]'),id]);}
 return assets;
}
