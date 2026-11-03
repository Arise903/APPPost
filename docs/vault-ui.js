/* Gate and export authorization for the encrypted workspace. */
(function(){
'use strict';
const V=()=>window.ReleaseVault;
const SAVED_KEY='release-desk-vault-saved:v1';
let dialog,body,title,status,banner;
function ensureDialog(){
 if(dialog)return dialog;
 dialog=document.createElement('dialog');
 dialog.id='vaultDialog';
 dialog.style.cssText='max-width:520px;width:calc(100% - 32px);padding:24px;border:1px solid #dce2df;border-radius:14px';
 title=document.createElement('h2');title.style.margin='0 0 12px';
 body=document.createElement('div');
 status=document.createElement('p');status.id='vaultDialogStatus';status.className='subtle small';status.setAttribute('role','alert');
 dialog.append(title,body,status);
 dialog.addEventListener('cancel',event=>{if(V().status()!=='unlocked')event.preventDefault();});
 document.body.appendChild(dialog);
 return dialog;
}
function message(text,kind=''){status.textContent=text||'';status.dataset.state=kind;}
const esc=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function keyFile(secret){
 const url=URL.createObjectURL(new Blob(['RELEASE DESK 加密密钥\n\n'+secret+'\n\n此密钥用于解密本机与云端的所有项目配置，丢失后无法恢复。\n'],{type:'text/plain;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download='release-desk-key.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function refreshStatusLabel(){
 const el=document.getElementById('vaultStatus');if(!el)return;
 const state=V().status();
 el.textContent=state==='unlocked'?'本机数据与导出已加密 · 当前会话已解锁':state==='locked'?'本机数据已加密 · 请输入密钥解锁':'尚未生成加密密钥';
 el.dataset.state=state==='unlocked'?'connected':'pending';
}
function rememberSaved(){try{localStorage.setItem(SAVED_KEY,String(Date.now()));}catch(_){}}
function savedAt(){try{return Number(localStorage.getItem(SAVED_KEY)||0);}catch(_){return 0;}}
function showKeyBanner(){
 if(banner||savedAt())return;
 banner=document.createElement('div');
 banner.id='vaultKeyBanner';
 banner.style.cssText='display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0;padding:12px 14px;border:1px solid #e6cf9c;border-radius:10px;background:#fff8e8;color:#7a5a12;font-size:13px';
 const text=document.createElement('span');
 text.textContent='加密密钥已生成，请立即保存：丢失后本机与云端数据都无法恢复。';
 const save=document.createElement('button');save.type='button';save.className='btn';save.textContent='保存密钥';
 save.onclick=()=>{
  const secret=V().secret()||'';
  keyFile(secret);
  navigator.clipboard?.writeText(secret).catch(()=>{});
  rememberSaved();refreshKeyBanner();
 };
 const done=document.createElement('button');done.type='button';done.className='btn primary';done.textContent='我已保存';
 done.onclick=()=>{if(!confirm('请确认已保存密钥文件，且能够找到该文件。丢失密钥将无法恢复加密记录。'))return;rememberSaved();refreshKeyBanner();};
 banner.append(text,save,done);
 (document.querySelector('.page-heading')||document.body).prepend(banner);
}
function refreshKeyBanner(){if(banner){banner.remove();banner=null;}}
function openUnlock(){
 ensureDialog();message('');
 title.textContent='输入加密密钥';
 body.innerHTML='<p class="subtle">本机与云端的所有项目配置都已加密。请输入加密密钥后继续；密钥丢失将无法恢复数据。</p>'+
  '<label style="display:block;margin:12px 0">加密密钥<input id="vaultInput" autocomplete="off" spellcheck="false" style="display:block;width:100%;margin:6px 0 0;padding:10px"></label>'+
  '<label style="display:block;margin:12px 0">或选择密钥文件（release-desk-key.txt）<input id="vaultFile" type="file" accept=".txt,.key,.json" style="display:block;margin:6px 0 0"></label>'+
  '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn primary" id="vaultUnlock" type="button">解锁</button></div>';
 dialog.showModal();
 document.getElementById('vaultInput').focus();
 document.getElementById('vaultFile').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  const text=await file.text();const found=(text.match(/[A-Z2-9]{4}(-[A-Z2-9]{4}){3,}/)||text.match(/\b[A-Z2-9]{20,}\b/)||[''])[0];
  if(found)document.getElementById('vaultInput').value=found;else message('密钥文件里没有找到密钥。','error');
 };
 document.getElementById('vaultUnlock').onclick=async()=>{
  try{await V().unlock(document.getElementById('vaultInput').value);refreshStatusLabel();dialog.close();location.reload();}
  catch(error){message(error.message,'error');}
 };
}
async function initialize(){
 const vault=V();if(!vault)return;
 refreshStatusLabel();
 if(vault.status()==='unlocked'){showKeyBanner();return;}
 if(vault.status()==='uninitialized'){
  ensureDialog();title.textContent='设置加密密钥';body.innerHTML='<p>选择使用已有密钥，或随机生成新密钥。已有记录将使用所选密钥加密。</p><input id="initialKey" placeholder="输入已有密钥" autocomplete="off"><button type="button" id="useKey" class="btn">使用已有密钥</button><button type="button" id="generateKey" class="btn primary">随机生成密钥</button>';dialog.showModal();
  let settingUp=false;const setup=async existing=>{if(settingUp)return;settingUp=true;body.querySelectorAll('button').forEach(b=>b.disabled=true);try{const key=document.getElementById('initialKey').value;if(existing&&!key.trim())throw Error('请输入已有密钥');if(vault.status()!=='unlocked')await vault.create(existing?key:undefined);await window.PagesStore?.initialize?.();await window.PagesStore?.sealAll?.();dialog.close();refreshStatusLabel();showKeyBanner();}catch(error){message('设置未完成，请保留密钥并重试：'+error.message,'error');}finally{settingUp=false;body.querySelectorAll('button').forEach(b=>b.disabled=false);}};
  document.getElementById('useKey').onclick=()=>setup(true);document.getElementById('generateKey').onclick=()=>setup(false);return;
 }
 openUnlock();
}
const api={requestKey:label=>new Promise((resolve,reject)=>{const d=document.createElement('dialog'),h=document.createElement('h2'),input=document.createElement('input'),ok=document.createElement('button'),cancel=document.createElement('button');h.textContent=label;input.type='password';input.autocomplete='off';input.setAttribute('aria-label','备份密钥');ok.textContent='继续';cancel.textContent='取消';const close=()=>{d.close();d.remove();};ok.onclick=()=>{if(!input.value.trim()){input.setCustomValidity('请输入密钥');input.reportValidity();return;}const key=input.value;close();resolve(key);};cancel.onclick=()=>{close();reject(Error('已取消导入'));};d.oncancel=event=>{event.preventDefault();cancel.click();};d.append(h,input,cancel,ok);document.body.append(d);d.showModal();input.focus();}),gate:initialize,refreshStatus:refreshStatusLabel,authorize:label=>V().authorize(label||'导出')};
window.ReleaseVaultUI=api;
/* 导出确认：每个导出都要求输入一次密钥。 */
function exportDialog(){
 ensureDialog();
 title.textContent='确认导出';
 body.innerHTML='<p class="subtle">为防止项目配置被他人直接带走，导出前请再次输入加密密钥。</p>'+
  '<label style="display:block;margin:12px 0">加密密钥<input id="vaultExportInput" autocomplete="off" spellcheck="false" style="display:block;width:100%;margin:6px 0 0;padding:10px"></label>'+
  '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="vaultExportCancel" type="button">取消</button><button class="btn primary" id="vaultExportConfirm" type="button">确认导出</button></div>';
 message('');
 dialog.showModal();
 document.getElementById('vaultExportInput').focus();
 document.getElementById('vaultExportCancel').onclick=()=>{dialog.close();V().resolveExport(null);};
 document.getElementById('vaultExportConfirm').onclick=()=>{const value=document.getElementById('vaultExportInput').value;dialog.close();V().resolveExport(value);};
 dialog.addEventListener('cancel',()=>V().resolveExport(null),{once:true});
}
document.addEventListener('vault-authorize-request',exportDialog);
/* 所有下载都必须先输入密钥，避免解锁状态下被一键带走。 */
const store=window.PagesStore;
if(store&&typeof store.download==='function'){
 const original=store.download.bind(store);
 store.download=async(name,text,type='application/json')=>{
  const notify=message=>{if(typeof toast==='function')toast(message);else if(typeof notice==='function')notice(message);else alert(message);};
  try{await api.authorize('导出 '+name);}
  catch(error){if(error.cancelled)return false;notify(error.message);return false;}
  if(type==='application/json'){try{const value=JSON.parse(text);if(['release-desk/v1','release-desk-workspace/v1'].includes(value.format))text=JSON.stringify(await V().exportFile(value),null,2);}catch(error){notify(error.message);return false;}}
  return original(name,text,type);
 };
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{initialize();});
else initialize();
})();
