'use strict';
let account = null;
let projects = [];
let selectedProject = null;
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let noticeTimer;
function notify(message){ $('notice').textContent=message; $('notice').hidden=false; clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>$('notice').hidden=true,6500); }
async function api(path, data){
 const response=await fetch(path, data===undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':account?.csrf || ''},body:JSON.stringify(data)});
 const result=await response.json();
 if(!response.ok){ if(response.status===401 && document.body.dataset.page==='dashboard') location.href='/login'; throw new Error(result.error || '请求失败'); }
 return result;
}
function formObject(form){ return Object.fromEntries(new FormData(form)); }
function bindForm(id, action, errorId){
 const form=$(id); if(!form)return;
 form.addEventListener('submit',async event=>{
  event.preventDefault(); const button=form.querySelector('[type=submit],button:not([type=button])'); if(button)button.disabled=true;
  if(errorId)$(errorId).textContent='';
  try{ await action(form); }catch(error){ if(errorId)$(errorId).textContent=error.message;else notify(error.message); }
  finally{ if(button)button.disabled=false; }
 });
}
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
bindForm('loginForm',async form=>{ await api('/api/auth/login',formObject(form));location.href='/'; },'formError');
bindForm('joinForm',async form=>{ await api('/api/invitations/accept',{...formObject(form),token:location.hash.slice(1)});location.href='/'; },'formError');
function openCreate(){ $('createForm').reset();$('createError').textContent='';$('createDialog').showModal(); }
async function loadProjects(){
 const data=await api('/api/projects'); projects=data.projects;
 $('projectCount').textContent=projects.length;
 $('resolvedCount').textContent=projects.reduce((n,p)=>n+p.done+p.skipped,0);
 $('pendingCount').textContent=projects.reduce((n,p)=>n+p.total-p.done-p.skipped,0);
 renderProjects();
}
function renderProjects(){
 const query=$('search').value.toLowerCase();
 const visible=projects.filter(p=>p.name.toLowerCase().includes(query));
 $('countLabel').textContent=visible.length;
 if(!visible.length){
  $('projectGrid').innerHTML='<div class="empty-state"><span class="empty-icon">▦</span><h3>'+ (query?'没有找到匹配的项目':'你的下一次发布，从这里开始')+'</h3><p class="subtle">'+(query?'试试其他项目名称。':'新建项目使用初始清单，也可以导入已有 Markdown 或完整项目记录。')+'</p>'+(!query?'<button class="button primary" id="emptyCreate">＋ 创建第一个项目</button>':'')+'</div>';
  if($('emptyCreate'))$('emptyCreate').onclick=openCreate;return;
 }
 $('projectGrid').innerHTML=visible.map(p=>{
  const resolved=p.done+p.skipped,percent=p.total?Math.round(resolved/p.total*100):0;
  const meta=[p.release?.platform,p.release?.version?'v'+p.release.version:'',new Date(p.updated_at*1000).toLocaleDateString('zh-CN')+' 更新'].filter(Boolean).join(' · ');
  return `<article class="project-card"><div class="card-top"><span class="project-icon">${escape(p.name.slice(0,1).toUpperCase())}</span><span class="role-tag">${{owner:'所有者',editor:'编辑者',viewer:'查看者'}[p.role]}</span></div><h3><a href="/projects/${p.id}">${escape(p.name)}</a></h3><p class="project-meta">${escape(meta)}</p><div class="progress-label"><span>${resolved} / ${p.total} 项已处理 · ${p.skipped} 项跳过</span><b>${percent}%</b></div><div class="progress-track" role="progressbar" aria-label="${escape(p.name)}检查进度" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div style="width:${percent}%"></div></div><div class="card-bottom"><div class="card-actions"><button data-export="${p.id}">导出完整记录</button>${p.role==='owner'?`<button data-team="${p.id}">管理成员</button>`:''}</div><a class="open-project" href="/projects/${p.id}">继续检查 ↗</a></div></article>`;
 }).join('');
}
bindForm('createForm',async form=>{
 const data={name:form.elements.name.value.trim()}; const file=form.elements.file.files[0];
 if(file){
  if(file.size>1_500_000)throw new Error('导入文件请小于 1.5 MB');
  const text=await file.text();
  if(file.name.toLowerCase().endsWith('.json')){
   let imported;try{imported=JSON.parse(text);}catch(_){throw new Error('JSON 文件格式不正确');}
   if(imported.format!=='release-desk/v1' || typeof imported.document!=='string')throw new Error('请选择工作台导出的完整项目 JSON');
   Object.assign(data,{document:imported.document,permissions:imported.permissions,review:imported.review});
  }else data.document=text;
 }
 const result=await api('/api/projects',data);location.href='/projects/'+result.id;
},'createError');
async function showTeam(id){
 selectedProject=id; $('inviteResult').hidden=true;
 const result=await api('/api/projects/'+id+'/members');
 $('memberList').innerHTML=result.members.map(m=>`<div class="member-row"><div><strong>${escape(m.name)}</strong><small>${escape(m.email)}</small></div>${m.role==='owner'?'<span class="role-tag">所有者</span>':`<select data-member="${m.id}" aria-label="${escape(m.name)}的角色"><option value="editor" ${m.role==='editor'?'selected':''}>编辑者</option><option value="viewer" ${m.role==='viewer'?'selected':''}>查看者</option><option value="remove">移除成员</option></select>`}</div>`).join('');
 $('teamDialog').showModal();
}
bindForm('inviteForm',async form=>{
 const result=await api('/api/projects/'+selectedProject+'/invite',formObject(form));
 $('inviteLink').value=location.origin+result.path; $('inviteResult').hidden=false;
});
bindForm('passwordForm',async form=>{
 account=await api('/api/auth/password',formObject(form));
 $('passwordDialog').close();form.reset();notify('密码已修改，其他设备的登录已失效');
});
async function startDashboard(){
 try{
  account=await api('/api/me');
  $('userName').textContent=account.user.name;
  $('userEmail').textContent=account.user.email;
  $('avatar').textContent=account.user.name.slice(0,1);
  await loadProjects();
 }catch(error){notify(error.message);$('projectGrid').textContent='项目加载失败，请刷新重试。';}
 $('newProject').onclick=openCreate;
 $('search').oninput=renderProjects;
 $('logout').onclick=async()=>{try{await api('/api/auth/logout',{});location.href='/login';}catch(e){notify(e.message);}};
 $('passwordButton').onclick=()=>$('passwordDialog').showModal();
 $('copyInvite').onclick=async()=>{try{await navigator.clipboard.writeText($('inviteLink').value);notify('邀请链接已复制');}catch(_){$('inviteLink').select();notify('请复制已选中的邀请链接');}};
 $('projectGrid').onclick=async event=>{
  try{
   const team=event.target.closest('[data-team]');if(team){await showTeam(team.dataset.team);return;}
   const exportButton=event.target.closest('[data-export]');
   if(exportButton){
    const response=await fetch('/api/projects/'+exportButton.dataset.export+'/export');
    if(!response.ok)throw new Error('导出失败，请刷新重试');
    const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='release-project.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }
  }catch(e){notify(e.message);}
 };
 $('memberList').onchange=async event=>{
  const select=event.target.closest('[data-member]');if(!select)return;
  if(!confirm(select.value==='remove'?'移除该成员的项目访问权限？':'更新该成员的项目角色？')){await showTeam(selectedProject);return;}
  try{await api('/api/projects/'+selectedProject+'/members',{userId:select.dataset.member,role:select.value});await showTeam(selectedProject);notify('成员权限已更新');}catch(e){notify(e.message);}
 };
}
if(document.body.dataset.page==='dashboard')startDashboard();
