/* Manual, private-repository workspace sync for the GitHub Pages edition. */
(function(){
'use strict';
const S=PagesStore,OWNER='Arise903',REPO='APPdata',BRANCH='main',FILE='release-desk/workspace.json';
const TOKEN_KEY='release-desk-github-token:session:v1',STATE_KEY='release-desk-github-sync:v1';
const $=id=>document.getElementById(id);let token='',busy=false;
const state=()=>{try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch(_){return {}}};
function remember(value){try{localStorage.setItem(STATE_KEY,JSON.stringify(value))}catch(_){}}
function status(text,kind=''){const el=$('githubSyncStatus');if(!el)return;el.textContent=text;el.dataset.state=kind;}
function setBusy(value){busy=value;for(const id of ['githubSyncPush','githubSyncPull','githubSyncConnect','githubSyncDisconnect'])if($(id))$(id).disabled=value||($(id).dataset.needsToken==='true'&&!token);}
function renderConnection(){
 const connected=!!token;
 $('githubSyncConnect').hidden=connected;$('githubSyncDisconnect').hidden=!connected;
 $('githubSyncPush').disabled=!connected||busy;$('githubSyncPull').disabled=!connected||busy;
 if(!connected){status('未连接。上传前请先生成仅授权 APPdata 仓库的 Fine-grained token。');return;}
 const sync=state();status('已连接 '+OWNER+'/'+REPO+' · 授权仅保存在当前标签页会话中'+(sync.lastSyncedAt?' · 上次同步 '+new Date(sync.lastSyncedAt).toLocaleString():''),'connected');
}
async function request(path,options={}){
 const response=await fetch('https://api.github.com'+path,{...options,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
 const text=await response.text();let body={};try{body=text?JSON.parse(text):{}}catch(_){body={message:text.slice(0,300)}}
 if(!response.ok){const error=new Error(body.message||('GitHub API 返回 '+response.status));error.status=response.status;throw error;}
 return body;
}
function norm(bundle){return {format:'release-desk-workspace/v1',projects:bundle.projects||[],drafts:bundle.drafts||{}};}
async function hash(bundle){const bytes=new TextEncoder().encode(JSON.stringify(norm(bundle)));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function decodeBase64(value){const bytes=Uint8Array.from(atob(value.replace(/\s/g,'')),char=>char.charCodeAt(0));return new TextDecoder().decode(bytes);}
async function getRemote(){
 const repo=await request('/repos/'+OWNER+'/'+REPO);if(!repo.private)throw Error('目标仓库不是私有仓库，已停止读取。');
 const branch=repo.default_branch||BRANCH;let ref;
 try{ref=await request('/repos/'+OWNER+'/'+REPO+'/git/ref/heads/'+encodeURIComponent(branch));}
 catch(error){if(error.status===404&&Number(repo.size)===0)return {repo,branch,empty:true,branchSha:null,workspace:null,fileSha:null};throw Error(error.status===404?'私有仓库没有可读取的默认分支；请先在 GitHub 初始化 README。':error.message);}
 const branchSha=ref.object.sha,commit=await request('/repos/'+OWNER+'/'+REPO+'/git/commits/'+branchSha);
 const tree=await request('/repos/'+OWNER+'/'+REPO+'/git/trees/'+commit.tree.sha+'?recursive=1');
 if(tree.truncated)throw Error('APPdata 仓库文件过多，无法安全定位同步文件。');
 const entry=(tree.tree||[]).find(item=>item.path===FILE&&item.type==='blob');
 if(!entry)return {repo,branch,empty:false,branchSha,workspace:null,fileSha:null};
 const blob=await request('/repos/'+OWNER+'/'+REPO+'/git/blobs/'+entry.sha);
 if(blob.encoding!=='base64')throw Error('GitHub 返回了不支持的文件编码。');
 let workspace;try{workspace=JSON.parse(decodeBase64(blob.content));}catch(_){throw Error('GitHub 里的工作台 JSON 无效；本机数据没有改动。');}
 S.inspectImportAll(workspace);
 return {repo,branch,empty:false,branchSha,workspace,fileSha:entry.sha};
}
async function writeRemote(bundle,remote){
 const content=JSON.stringify(norm(bundle),null,2);
 if(new Blob([content]).size>20000000)throw Error('工作台备份超过 20 MB，请先清理历史项目或使用本机 JSON 备份。');
 const blob=await request('/repos/'+OWNER+'/'+REPO+'/git/blobs',{method:'POST',body:JSON.stringify({content,encoding:'utf-8'})});
 const treeBody={tree:[{path:FILE,mode:'100644',type:'blob',sha:blob.sha}]};if(remote.branchSha)treeBody.base_tree=(await request('/repos/'+OWNER+'/'+REPO+'/git/commits/'+remote.branchSha)).tree.sha;
 const tree=await request('/repos/'+OWNER+'/'+REPO+'/git/trees',{method:'POST',body:JSON.stringify(treeBody)});
 const commit=await request('/repos/'+OWNER+'/'+REPO+'/git/commits',{method:'POST',body:JSON.stringify({message:'Sync Release Desk workspace',tree:tree.sha,...(remote.branchSha?{parents:[remote.branchSha]}:{})})});
 let ref;
 if(remote.branchSha)ref=await request('/repos/'+OWNER+'/'+REPO+'/git/refs/heads/'+encodeURIComponent(remote.branch),{method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})});
 else ref=await request('/repos/'+OWNER+'/'+REPO+'/git/refs',{method:'POST',body:JSON.stringify({ref:'refs/heads/'+remote.branch,sha:commit.sha})});
 return {commit:commit.sha,ref:ref.object.sha};
}
function saveSyncState(sha,digest){remember({fileSha:sha,hash:digest,lastSyncedAt:Date.now(),repo:OWNER+'/'+REPO});}
async function connect(value){
 token=value.trim();
 try{
  const repo=await request('/repos/'+OWNER+'/'+REPO);if(!repo.private)throw Error('APPdata 必须是私有仓库。');
  sessionStorage.setItem(TOKEN_KEY,token);$('githubToken').value='';$('githubSyncDialog').close();renderConnection();
 }catch(error){token='';renderConnection();throw Error(error.status===401?'Token 无效或已过期。':error.status===403?'Token 缺少 APPdata 的 Contents 读写权限。':error.message);}
}
async function push(){
 if(!token)return $('githubSyncDialog').showModal();setBusy(true);status('正在检查私有仓库…','busy');
 try{
  const local=S.exportAll(),digest=await hash(local),remote=await getRemote();
  if(remote.workspace&&await hash(remote.workspace)===digest){saveSyncState(remote.fileSha,digest);status('本机和 GitHub 数据一致，无需上传。','connected');return;}
  const count=local.projects.length,remoteCount=remote.workspace?.projects?.length||0;
  const changed=remote.workspace&&remote.fileSha!==state().fileSha;
  const message=(remote.workspace?'GitHub 中已有 '+remoteCount+' 个项目。':'APPdata 尚无 Release Desk 备份。')+'\n\n将把当前浏览器的 '+count+' 个项目和草稿写入私有仓库 '+OWNER+'/'+REPO+'。'+(changed?'\n云端版本与上次同步不同；此次会创建新提交，旧版本仍可从 Git 历史恢复。':'')+'\n\n继续上传？';
  if(!confirm(message)){status('已取消上传。');return;}
  status('正在创建 Git 提交…','busy');const result=await writeRemote(local,remote),updated=await getRemote(),remoteHash=await hash(updated.workspace);
  saveSyncState(updated.fileSha||result.commit,remoteHash);status('上传完成 · 提交 '+result.commit.slice(0,7)+' · '+count+' 个项目。','connected');
 }catch(error){status(error.message==='Failed to fetch'?'无法连接 GitHub API；请检查网络和仓库授权。':error.message,'error');}
 finally{setBusy(false);}
}
async function pull(){
 if(!token)return $('githubSyncDialog').showModal();setBusy(true);status('正在读取 GitHub 备份…','busy');
 try{
  const remote=await getRemote();if(!remote.workspace){status('私有仓库里还没有工作台备份，请先上传本机数据。');return;}
  const preview=S.inspectImportAll(remote.workspace),local=S.exportAll();
  if(!confirm('从 GitHub 拉取预览\n\n云端项目：'+preview.projects+' 个\n云端历史快照：'+preview.snapshots+' 份\n本机项目：'+local.projects.length+' 个\n\n同 ID 项目会以云端版本为当前版本，并将不同的本机版本保留为项目快照；本机独有项目和已有草稿会保留。拉取前会下载一份完整本机备份。继续吗？')){status('已取消拉取。');return;}
  S.download('release-workspace-before-github-pull-'+new Date().toLocaleDateString('sv-SE')+'.json',JSON.stringify(local,null,2));
  const result=await S.mergeRemoteAll(remote.workspace),digest=await hash(remote.workspace);saveSyncState(remote.fileSha,digest);
  status('拉取完成 · 新增 '+result.added+' 个，更新 '+result.updated+' 个；本机独有项目已保留。'+(result.draftError?'部分草稿写入失败，请保留刚下载的备份。':''),'connected');
  setTimeout(()=>location.reload(),1200);
 }catch(error){status(error.message==='Failed to fetch'?'无法连接 GitHub API；请检查网络和仓库授权。':error.message,'error');}
 finally{setBusy(false);}
}
function boot(){
 if(!$('githubSyncStatus'))return;
 try{token=sessionStorage.getItem(TOKEN_KEY)||'';}catch(_){token='';}
 renderConnection();
 $('githubSyncConnect').onclick=()=>$('githubSyncDialog').showModal();
 $('githubSyncDisconnect').onclick=()=>{sessionStorage.removeItem(TOKEN_KEY);token='';renderConnection();status('已断开本次会话。GitHub 中的数据未删除。');};
 $('githubSyncCancel').onclick=()=>$('githubSyncDialog').close();
 $('githubSyncForm').onsubmit=async event=>{event.preventDefault();const button=$('githubTokenSubmit');button.disabled=true;try{await connect($('githubToken').value);}catch(error){$('githubTokenError').textContent=error.message;}finally{button.disabled=false;}};
 $('githubSyncPush').onclick=push;$('githubSyncPull').onclick=pull;
 if(token){getRemote().then(remote=>{if(remote.workspace)status('已连接 '+OWNER+'/'+REPO+' · 检测到 '+remote.workspace.projects.length+' 个云端项目；选择上传或拉取。','connected');}).catch(error=>{if(error.status===401){sessionStorage.removeItem(TOKEN_KEY);token='';renderConnection();status('Token 已过期，请重新连接。','error');}else status('连接检查失败：'+error.message,'error');});}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
