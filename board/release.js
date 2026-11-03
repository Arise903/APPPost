async function persistReview(next,extra={}){
  try{
    const previousPlatform=reviewData.release?.platform;
    const d = await api("/api/review", {revision:baseRevision, review:next,...extra});
    baseRevision = d.revision;
    reviewData = d.review;DATA.assetIds=d.assetIds||DATA.assetIds;
    updateSummaryReleaseOptions();
    if(previousPlatform!==reviewData.release?.platform)build();else document.querySelectorAll('li.item').forEach(row=>updateItemSummary(row,reviewData.items?.[row.dataset.id]));refreshAll();saveState();
    toast("检查记录已保存");
    return true;
  }catch(e){ toast("保存失败：" + e.message); return false; }
}
document.getElementById('releaseEdit').onclick=openReleaseEditor;
function releaseSnapshot(){
  const snapshot={evidenceFiles:JSON.parse(JSON.stringify(reviewData.evidenceFiles||{})),assetIds:DATA.assetIds||[],preflight:reviewData.preflight||null,permissions:{selected:DATA.permSelected||[],descs:DATA.permDescs||{},descsEn:DATA.permDescsEn||{}},subscriptions:JSON.parse(JSON.stringify(reviewData.subscriptions||[])), release:reviewData.release || {}, date:new Date().toISOString(), features:{...DATA.features}, selectedPermissions:[...(DATA.permSelected||[])], items:[...(DATA.preamble||[]),...DATA.sections.flatMap(s => s.blocks)].filter(b => b.type === "item" && !b.gate).map(b => ({...reviewData.items?.[b.id],id:b.id,text:b.text,state:st(b.id), applicable:b.visible !== false}))};
  snapshot.readiness=ReleaseReadiness.assess(snapshot);return snapshot;
}
document.getElementById("releaseArchive").onclick = async () => {
  if(!gateDone){toast("请先阅读并确认使用说明");return;}
  if(!online || dirty || featureHasChanges() || permDirty || savingOperations>0 || boardPendingDetails().length){ toast("请先保存检查进度、项目设置和权限配置，再归档"); return; }
  const snapshot=releaseSnapshot();
  const confirmation=await BoardProductivity.confirmArchive(snapshot,reviewData.history?.at(-1));
  if(!confirmation)return;
  const next=JSON.parse(JSON.stringify(reviewData));
  next.history=next.history||[];
  snapshot.conclusion=ReleaseAnalysis.decision(snapshot,next.history.at(-1),confirmation);
  next.history.push(snapshot);
  await persistReview(next);
};
function releaseMetrics(snapshot){
  const applicable=(Array.isArray(snapshot.items)?snapshot.items:[]).filter(item=>item&&item.applicable!==false);
  const done=applicable.filter(item=>item.state==="done").length;
  const skipped=applicable.filter(item=>item.state==="skip").length;
  const total=applicable.length;
  return {total,done,skipped,pending:Math.max(0,total-done-skipped),percent:total?Math.round(done/total*100):0};
}
function updateSummaryReleaseOptions(){
  const select=document.getElementById("summaryVersion");if(!select)return;
  const previous=select.value,history=reviewData.history||[];
  select.replaceChildren(new Option("当前发布 · "+(reviewData.release?.version||"未填写版本"),"current"));
  history.forEach((snapshot,index)=>{
    const version=snapshot.release?.version||snapshot.version||("历史发布 "+(index+1));
    const date=snapshot.date?new Date(snapshot.date).toLocaleDateString():"";
    select.add(new Option(version+(date?" · "+date:""),"history:"+index));
  });
  if([...select.options].some(option=>option.value===previous))select.value=previous;
  updateReleaseDeleteButton();
}
function updateReleaseDeleteButton(){
  const button=document.getElementById("releaseDelete"),select=document.getElementById("summaryVersion");
  if(!button)return;
  const archived=String(select?.value||"").startsWith("history:");
  button.disabled=!archived;
  button.title=archived?"删除所选历史版本（不可恢复，当前发布不受影响）":"先在导出版本里选择一个已归档的历史版本";
}
function archiveLabel(snapshot,index){
  const version=snapshot.release?.version||snapshot.version||("历史发布 "+(index+1));
  return version+(snapshot.date?" · "+new Date(snapshot.date).toLocaleDateString():"");
}
document.getElementById("summaryVersion").addEventListener("change",updateReleaseDeleteButton);
document.getElementById("releaseDelete").onclick=async()=>{
  const select=document.getElementById("summaryVersion"),selection=select.value;
  if(!selection.startsWith("history:")){toast("当前发布不能删除；请先在发布里归档，再删除历史版本");return;}
  if(!online||!gateDone){toast("请先连接存储服务并确认使用说明");return;}
  if(dirty||featureHasChanges()||permDirty||savingOperations>0){toast("请先保存检查进度、项目设置和权限配置，再删除历史版本");return;}
  const index=Number(selection.split(":")[1]),history=reviewData.history||[],snapshot=history[index];
  if(!snapshot){toast("找不到所选发布记录");return;}
  const label=archiveLabel(snapshot,index);
  if(!confirm("删除历史版本「"+label+"」？\n\n删除后不可恢复，当前发布与检查进度不受影响。如果还需要这份记录，请先“导出发布摘要”。"))return;
  const next=JSON.parse(JSON.stringify(reviewData));
  next.history=history.filter((_,position)=>position!==index);
  select.value="current";
  if(await persistReview(next))toast("已删除历史版本 "+label);
};
updateSummaryReleaseOptions();
document.getElementById("releaseSummary").onclick = () => {
  const selection=document.getElementById("summaryVersion").value;
  const history=reviewData.history||[];
  const snapshot=selection.startsWith("history:")?history[Number(selection.split(":")[1])]:releaseSnapshot();
  if(!snapshot){toast("找不到所选发布记录");return;}
  const versions=[...history.map((value,index)=>({snapshot:value,label:value.release?.version||value.version||("历史发布 "+(index+1))})),{snapshot:releaseSnapshot(),label:reviewData.release?.version||"当前发布"}];
  const pendingExport=selection==="current"&&(dirty||featureHasChanges()||permDirty||savingOperations>0);
  const lines = ["# 发布检查摘要", "", "导出版本："+(snapshot.release?.version||snapshot.version||"未填写版本"), ...Object.entries(snapshot.release||{}).filter(([key])=>key!=="version").map(([k,v])=>k+"："+v), "", "生成时间："+new Date().toLocaleString(), pendingExport?"注意：包含尚未全部保存的当前页面内容。":"", "", "## 各版本进度对比", "", "完成率按适用检查项计算；不适用项不计入分母。", "", "| 版本 | 日期 | 已完成 | 已跳过 | 待处理 | 完成率 |", "| --- | --- | ---: | ---: | ---: | ---: |"];
  versions.forEach(({snapshot:version,label})=>{const m=releaseMetrics(version);lines.push("| "+String(label).replace(/[|\n]/g," ")+" | "+(version.date?new Date(version.date).toLocaleDateString():"—")+" | "+m.done+" / "+m.total+" | "+m.skipped+" | "+m.pending+" | "+m.percent+"% |");});
  const readiness=snapshot.readiness||ReleaseReadiness.assess(snapshot);lines.push('', '## 发布就绪检查', '', '策略版本：'+readiness.policyVersion, '发布状态：'+(readiness.ready?'已就绪':'未就绪'), '阻塞项：'+readiness.blockers+'；缺少必需证据：'+readiness.missingEvidence,...readiness.issues.map(i=>'- '+i.reason+'：'+i.text));
  lines.push("", ...ReleaseAnalysis.decisionLines(snapshot,selection.startsWith("history:")?history[Number(selection.split(":")[1])-1]:history.at(-1)));
  lines.push("", "## 订阅商品配置", "", "```json", JSON.stringify(snapshot.subscriptions||[],null,2), "```", "", "## 所选版本检查项");
  for(const item of (Array.isArray(snapshot.items)?snapshot.items:[])){
    lines.push("- [" + ({done:"x",skip:"-",todo:" "}[item.state]) + "] " + item.text + (item.applicable===false ? "（不适用）" : ""));
    for(const [key,label] of [["reason","跳过原因"],["notes","备注"],["evidence","证据"]]) if(item[key]) lines.push("  "+label+"："+item[key]);
  }
  const url = URL.createObjectURL(new Blob([lines.join("\n")], {type:"text/markdown;charset=utf-8"}));
  const a = document.createElement("a"); a.href=url; a.download="发布检查摘要-"+String(snapshot.release?.version||snapshot.version||"版本").replace(/[^\w.-]+/g,"_")+".md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.getElementById("backupRestore").onclick = async () => {
  if(!online){ toast("请先连接本地服务"); return; }
  try{
    const d = await api("/api/backups", {});
    if(!d.backups.length){ toast("暂无备份"); return; }
    const choice = prompt("输入要恢复的备份序号：\n" + d.backups.map((n,i) => (i+1) + ". " + (d.entries ? new Date(d.entries[i].created_at * 1000).toLocaleString() + " · " + d.entries[i].label : n)).join("\n"));
    if(choice === null) return;
    const index = Number(choice)-1;
    const name = d.backups[index];
    if(!name){ toast("序号无效"); return; }
    const entry = d.entries && d.entries[index];
    const detail = entry ? "\n\n备份时间：" + new Date(entry.created_at * 1000).toLocaleString() + "\n备份说明：" + entry.label : "";
    if(!confirm("恢复前预览" + detail + "\n\n恢复会替换当前清单与检查状态；当前数据会先创建快照。未保存草稿不会并入恢复结果。是否继续？")) return;
    const result = await api("/api/restore", {name, revision:baseRevision});
    localStorage.removeItem(LS_KEY);
    dirty = false;
    location.reload();
  }catch(e){ toast("恢复失败：" + e.message); }
};

