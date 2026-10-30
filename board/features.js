/* --------------------------------------------------------------
 * 项目设置：账号系统 / 未成年用户
 * 切换后立即重算可见条目并重新连续编号；保存时写回 md 的 FEATURES 行。
 * -------------------------------------------------------------- */
const featPush = document.getElementById("featPush");
const featSubscription = document.getElementById("featSubscription");
const featFeedback = document.getElementById("featFeedback");
const featAcc = document.getElementById("featAcc");
const featMinor = document.getElementById("featMinor");

function currentFeatures(){
  return {
    hasAccountSystem: !!(DATA && DATA.features && DATA.features.hasAccountSystem),
    hasPush: DATA?.features?.hasPush === true,
    hasSubscriptions: DATA?.features?.hasSubscriptions !== false,
    hasFeedbackSystem: !!(DATA && DATA.features && DATA.features.hasFeedbackSystem),
    targetMinors: !!(DATA && DATA.features && DATA.features.targetMinors)
  };
}
function refreshFeatUI(){
  const f = currentFeatures();
  featPush.checked = f.hasPush;
  featSubscription.checked = f.hasSubscriptions;
  featFeedback.checked = f.hasFeedbackSystem;
  featAcc.checked = f.hasAccountSystem;
  featMinor.checked = f.targetMinors;
  // 顶部「已隐藏 N 项」提示
  const hidden = featureHiddenItems();
  const pill = document.getElementById("featPill");
  if(pill){
    pill.classList.toggle("hidden", hidden.length === 0);
    const b = pill.querySelector("b");
    if(b) b.textContent = hidden.length;
  }
  // 面板内的预览
  const pv = document.getElementById("featPreview");
  if(pv){
    const visible = (DATA.sections || []).flatMap(sec => sec.blocks || []).filter(it => it.type === "item" && !it.gate && it.visible !== false);
    const label = {hasAccountSystem:"无用户账号系统",hasFeedbackSystem:"无用户反馈系统",hasSubscriptions:"无订阅商品",hasPush:"无推送功能",targetMinors:"不面向未成年用户"};
    const clean = value => escapeHtml(String(value).replace(/<[^>]+>/g, "").replace(/\*\*/g, "").replace(/`/g, ""));
    const grouped = {};
    hidden.forEach(it => { (grouped[it.cond] = grouped[it.cond] || []).push(it.text); });
    const shown = visible.slice(0, 12).map(it => "· " + clean(it.text)).join("<br>");
    const hiddenHtml = Object.keys(grouped).map(key => "<span class=\"fx\"><b>" + (label[key] || key) + "</b> — " + grouped[key].length + " 项<br>" + grouped[key].map(text => "· " + clean(text)).join("<br>") + "</span>").join("");
    pv.innerHTML = "<b>按当前开关预览（保存后生效）</b>" +
      "<details class=\"feature-preview-group\"><summary>将显示 " + visible.length + " 项" + (visible.length > 12 ? "（先列出 12 项）" : "") + "</summary><span class=\"fx\">" + (shown || "当前没有适用条目") + "</span></details>" +
      "<details class=\"feature-preview-group\"><summary>将隐藏 " + hidden.length + " 项</summary>" + (hiddenHtml || "<span class=\"fx\">没有隐藏检查项；权限相关条目由「权限配置」单独控制。</span>") + "</details>" +
      "<span class=\"feature-preview-foot\">权限相关项目仍由「权限配置」控制。" + (featureHasChanges() ? "当前预览尚未保存。" : "") + "</span>";
  }
}
let featureSnapshot = null;
let featFocusReturn = null;
function openFeatPanel(){
  featFocusReturn=document.activeElement;
  featureSnapshot = JSON.parse(JSON.stringify(DATA.features));
  refreshFeatUI();
  document.getElementById("featPanel").classList.add("on");
  document.getElementById("featClose").focus();
}
function closeFeatPanel(){
  if(featureSnapshot){ DATA.features=featureSnapshot; featureSnapshot=null; render(); refreshFeatUI(); updateSaveStatus(); }
  document.getElementById("featPanel").classList.remove("on");
  if(featFocusReturn&&featFocusReturn.isConnected)featFocusReturn.focus();
  featFocusReturn=null;
}
document.getElementById("btnFeat").addEventListener("click", openFeatPanel);
document.getElementById("featClose").addEventListener("click", closeFeatPanel);
document.getElementById("featCancel").addEventListener("click", closeFeatPanel);
document.getElementById("featPill").addEventListener("click", openFeatPanel);

// 切换开关 -> 立即预览
function onFeatToggle(){
  saveFailure="";
  if(!DATA) return;
  DATA.features = {
    hasPush: featPush.checked, hasSubscriptions: featSubscription.checked, hasFeedbackSystem: featFeedback.checked,
    hasAccountSystem: featAcc.checked,
    targetMinors: featMinor.checked
  };
  applyFeatures();
  render();
  refreshFeatUI();
  updateSaveStatus();
}
featPush.addEventListener("change", onFeatToggle);
featSubscription.addEventListener("change", onFeatToggle);
featFeedback.addEventListener("change", onFeatToggle);
featAcc.addEventListener("change", onFeatToggle);
featMinor.addEventListener("change", onFeatToggle);

// 保存到 md
document.getElementById("featSave").addEventListener("click", async () => {
  const f = {hasAccountSystem: featAcc.checked, targetMinors: featMinor.checked, hasPush: featPush.checked, hasSubscriptions: featSubscription.checked, hasFeedbackSystem: featFeedback.checked};
  if(!online){
    toast("离线模式无法写入文件，请启动本地服务");
    return;
  }
  try{
    const d = await api("/api/features", {features: f});
    baseRevision = d.revision;
    DATA = mergeItems(d);
    render();
    refreshFeatUI();
    featureSnapshot=null;
    closeFeatPanel();
    updateSaveStatus();
    toast("项目设置已保存到 md");
  }catch(e){
    toast("保存失败：" + e.message);
  }
});

