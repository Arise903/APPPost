/* Version awareness and backup tools shared by the personal dashboard and board. */
(function(){
'use strict';
const S=PagesStore;
function pending(){return (typeof dirty!=='undefined'&&dirty)||(typeof permDirty!=='undefined'&&permDirty)||(typeof featureHasChanges==='function'&&featureHasChanges())||(typeof savingOperations!=='undefined'&&savingOperations>0);}
async function backup(){S.download('release-workspace-'+new Date().toLocaleDateString('sv-SE')+'.json',JSON.stringify(S.exportAll(),null,2));await S.markExport();window.dispatchEvent(new Event('backupchanged'));}
let offered=false;
async function checkVersion(){
 try{
  const response=await fetch('version.json?check='+Date.now(),{cache:'no-store'});if(!response.ok)return;const latest=await response.json();
  if(latest.version===PAGES_DATA.version||offered)return;offered=true;
  const banner=document.createElement('div');banner.className='upgrade-banner'+(document.querySelector('.app-shell')?' dashboard-upgrade':'');banner.setAttribute('role','status');banner.textContent='发现网页新版本。刷新前可导出全部项目和浏览器草稿。';
  const refresh=document.createElement('button');refresh.className='button secondary';refresh.textContent='备份并刷新';refresh.onclick=async()=>{if((typeof featureHasChanges==='function'&&featureHasChanges())||(typeof permDirty!=='undefined'&&permDirty)||(typeof savingOperations!=='undefined'&&savingOperations>0)){alert('请先保存或取消项目设置，并等待权限保存完成，再刷新。检查进度草稿可以随备份导出。');return;}if(pending()&&!confirm('存在未保存修改。将先导出包含浏览器草稿的备份，再刷新页面，是否继续？'))return;try{await backup();const url=new URL(location.href);url.searchParams.set("v",latest.version);location.replace(url.href);}catch(e){alert('备份失败，未刷新：'+e.message);}};
  const later=document.createElement('button');later.className='button secondary';later.textContent='稍后';later.onclick=()=>banner.remove();banner.append(refresh,later);document.body.prepend(banner);
 }catch(_){/* Offline use keeps the currently loaded edition available. */}
}
function boot(){
 const label=document.createElement('div');label.className='version-label'+(document.querySelector('.app-shell')?' dashboard-version':'');label.textContent='网页版本 '+PAGES_DATA.version+' · 模板 '+PAGES_DATA.templateVersion;
 label.style.cssText='font-size:10px;color:#859087;padding:12px 24px;';document.body.append(label);
 checkVersion();document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkVersion();});setInterval(checkVersion,300000);
 if(document.getElementById('workspaceBackup')){
  document.getElementById('workspaceBackup').onclick=async()=>{try{await backup();showBackup();}catch(e){alert(e.message);}};
  document.getElementById('workspaceImport').onchange=async event=>{
   const file=event.target.files[0];if(!file)return;
   try{if(file.size>20000000)throw Error('工作台备份请小于 20 MB');const result=await S.importAll(JSON.parse(await file.text()));alert('已导入 '+result.ids.length+' 个项目，不覆盖现有项目。'+(result.draftError?'项目已导入，但部分浏览器草稿空间不足；请保留原备份。':''));location.reload();}catch(e){alert('导入失败：'+e.message);}finally{event.target.value='';}
  };
  showBackup();window.addEventListener('backupchanged',showBackup);
 }
}
function showBackup(){const el=document.getElementById('backupReminder');if(!el)return;try{const data=S.read(),date=data.lastBackupAt;el.textContent=date?'上次发起全部导出：'+new Date(date).toLocaleString()+'，请确认文件已保存':'尚未导出全部项目。请定期备份，避免清理浏览器后丢失记录。';el.classList.toggle('backup-due',Object.keys(data.projects).length>0&&(!date||Date.now()-date>7*86400000));}catch(e){el.textContent=e.message;}}
window.ReleaseExperience={backup,checkVersion,pending};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
