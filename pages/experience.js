/* Version awareness and backup tools shared by the personal dashboard and board. */
(function(){
'use strict';
const S=PagesStore;
function pending(){return (typeof subscriptionDialog!=='undefined'&&subscriptionDialog.open&&JSON.stringify(subscriptionRead())!==subscriptionBaseline)|| (typeof dirty!=='undefined'&&dirty)||(typeof permDirty!=='undefined'&&permDirty)||(typeof featureHasChanges==='function'&&featureHasChanges())||(typeof savingOperations!=='undefined'&&savingOperations>0);}
async function backup(){S.download('release-workspace-'+new Date().toLocaleDateString('sv-SE')+'.json',JSON.stringify(S.exportAll(),null,2));await S.markExport();window.dispatchEvent(new Event('backupchanged'));}
let offered=false;
async function checkVersion(){
 try{
  const response=await fetch('version.json?check='+Date.now(),{cache:'no-store'});if(!response.ok)return;const latest=await response.json();
  if(latest.version===PAGES_DATA.version||offered)return;offered=true;
  const banner=document.createElement('div');banner.className='upgrade-banner'+(document.querySelector('.app-shell')?' dashboard-upgrade':'');banner.setAttribute('role','status');banner.textContent='发现网页新版本。刷新前可导出全部项目和浏览器草稿。';
  const refresh=document.createElement('button');refresh.className='button secondary';refresh.textContent='备份并刷新';refresh.onclick=async()=>{if((typeof subscriptionDialog!=='undefined'&&subscriptionDialog.open&&JSON.stringify(subscriptionRead())!==subscriptionBaseline)||(typeof featureHasChanges==='function'&&featureHasChanges())||(typeof permDirty!=='undefined'&&permDirty)||(typeof savingOperations!=='undefined'&&savingOperations>0)){alert('请先保存或取消项目设置、订阅商品，并等待保存完成，再刷新。检查进度草稿可以随备份导出。');return;}if(pending()&&!confirm('存在未保存修改。将先导出包含浏览器草稿的备份，再刷新页面，是否继续？'))return;try{await backup();const url=new URL(location.href);url.searchParams.set("v",latest.version);location.replace(url.href);}catch(e){alert('备份失败，未刷新：'+e.message);}};
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
   try{
    if(file.size>20000000)throw Error('工作台备份请小于 20 MB');
    const bundle=JSON.parse(await file.text()),preview=S.inspectImportAll(bundle);
    const names=preview.names.length?preview.names.map((name,index)=>(index+1)+'. '+name).join('\n'):'（空备份）';
    const date=preview.exportedAt?new Date(preview.exportedAt).toLocaleString():'未记录导出时间';
    if(!confirm('导入前预览\n\n备份时间：'+date+'\n项目：'+preview.projects+' 个\n历史快照：'+preview.snapshots+' 份\n浏览器草稿：'+preview.drafts+' 份\n\n'+names+'\n\n导入会新增项目，不覆盖现有项目。继续吗？'))return;
    const result=await S.importAll(bundle);alert('已导入 '+result.ids.length+' 个项目，不覆盖现有项目。'+(result.draftError?'部分浏览器草稿空间不足；请保留原备份。':''));location.reload();
   }catch(e){alert('导入失败：'+e.message);}finally{event.target.value='';}
  };
  showBackup();window.addEventListener('backupchanged',showBackup);
 }
}
function showBackup(){const el=document.getElementById('backupReminder');if(!el)return;try{const data=S.read(),date=data.lastBackupAt;el.textContent=date?'最近一次发起备份下载：'+new Date(date).toLocaleString()+'。请确认 JSON 文件已下载并妥善保存；提醒记录不代表文件可恢复。':'尚未发起完整备份。清理浏览器数据或更换设备前，请导出并保存 JSON。';el.classList.toggle('backup-due',Object.keys(data.projects).length>0&&(!date||Date.now()-date>7*86400000));}catch(e){el.textContent=e.message;}}
window.ReleaseExperience={backup,checkVersion,pending};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
