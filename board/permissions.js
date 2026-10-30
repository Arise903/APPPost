/* ------------------------------------------------------------------ *
 * 权限与隐私配置面板
 * ------------------------------------------------------------------ */
let PROFILES = null;         // 权限元数据
let permFocusReturn = null;
let permSelected = [];       // 选中的权限 id
let permDescs = {};          // {permId: 中文用途描述}
let permDescsEn = {};        // {permId: 英文用途描述}
let permLang = "zh";         // 当前描述编辑语言
let permDirty = false;       // 面板内是否有未写入的改动
let gateDone = false;         // 是否已确认阅读使用说明（门禁）

function permById(id){
  return (PROFILES && PROFILES.permissions || []).find(p => p.id === id);
}
function iosKeysOf(p){
  const ios = (p && p.ios) || {};
  if(ios.infoplist_keys) return ios.infoplist_keys;
  if(ios.infoplist_key) return [{key: ios.infoplist_key, desc: ios.desc || "", desc_en: ios.desc_en || ""}];
  return [];
}
function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

async function loadProfiles(){
  if(PROFILES) return PROFILES;
  try{
    const r = await boardFetch("/api/profiles");
    PROFILES = await r.json();
  }catch(e){
    PROFILES = window.EMBEDDED_PROFILES || {scenarios:[],permissions:[],groups:[],appstore_data_types:[]};  }
  return PROFILES;
}

function renderScenarios(){
  const box = document.getElementById("scenarios");
  box.innerHTML = "";
  (PROFILES.scenarios || []).forEach(s => {
    const b = document.createElement("button");
    b.className = "scen";
    b.type = "button";
    b.innerHTML = "<b>" + escapeHtml(s.name) + "</b><span>" + escapeHtml(s.desc || "") + "</span>";
    b.addEventListener("click", () => {
      permSelected = (s.permissions || []).slice();
      permDescs = {};
      permDescsEn = {};
      permDirty = true;
      renderPerms();
      refreshPermGen();
    });
    box.appendChild(b);
  });
}

function renderPerms(){
  const focusedPermission=document.activeElement?.dataset.permissionId;
  const box = document.getElementById("permGroups");
  box.innerHTML = "";
  const groups = PROFILES.groups || [];
  const perms = PROFILES.permissions || [];
  const used = new Set(permSelected);

  const byGroup = new Map();
  groups.forEach(g => byGroup.set(g.id, []));
  perms.forEach(p => {
    if(!byGroup.has(p.group)) byGroup.set(p.group, []);
    byGroup.get(p.group).push(p);
  });

  for(const [gid, list] of byGroup.entries()){
    if(!list.length) continue;
    const gname = (groups.find(g => g.id === gid) || {}).name || gid;
    const wrap = document.createElement("div");
    wrap.style.marginBottom = "14px";
    const h = document.createElement("div");
    h.style.cssText = "font-size:11.5px;color:var(--text-3);margin:0 0 7px";
    h.textContent = gname;
    wrap.appendChild(h);

    const grid = document.createElement("div");
    grid.className = "permgrid";
    list.forEach(p => {
      const el = document.createElement("div");
      el.className = "perm" + (used.has(p.id) ? " on" : "");
      const iosKeys = iosKeysOf(p);
      const a = p.android || {};
      const io = [];
      iosKeys.forEach(k => io.push(k.key));
      if(a.manifest) io.push(a.manifest);
      const nm = permLang === "en" ? (p.name_en || p.id) : p.name;
      const hint = permLang === "en" ? (p.panel_hint_en || "") : (p.panel_hint || "");
      el.innerHTML =
        '<div class="nm"><span class="tick"></span>' + escapeHtml(nm) + "</div>" +
        '<div class="io">' + (io.length
          ? io.map(c => "<code>" + escapeHtml(c) + "</code>").join("<br>")
          : "无需声明权限") + "</div>" +
        (hint ? '<div class="phint">' + escapeHtml(hint) + "</div>" : "");
      const toggle=document.createElement('button');toggle.type='button';toggle.className='permission-toggle';toggle.dataset.permissionId=p.id;toggle.setAttribute('aria-pressed',String(used.has(p.id)));while(el.firstChild)toggle.append(el.firstChild);el.append(toggle);
      const maintenance=document.createElement('details');maintenance.className='permission-maintenance';const title=document.createElement('summary');title.textContent='来源与适用版本';maintenance.append(title);const info=document.createElement('p'),meta=p.maintenance||{};info.textContent='适用版本：'+(meta.applicableVersions||'待核验')+' · 核验日期：'+(meta.lastVerified||'尚未核验');maintenance.append(info);for(const source of [...(meta.sources||[]),...(EMBEDDED_PROFILES.maintenance?.references||[])]){const url=typeof source==='string'?source:source.url;if(!/^https?:\/\//.test(url||''))continue;const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent=source.title||url;maintenance.append(link,document.createElement('br'));}maintenance.addEventListener('click',event=>event.stopPropagation());el.append(maintenance);
      toggle.addEventListener("click", () => {
        const i = permSelected.indexOf(p.id);
        if(i >= 0) permSelected.splice(i, 1);
        else permSelected.push(p.id);
        permDirty = true;
        renderPerms();
        refreshPermGen();
      });
      grid.appendChild(el);
    });
    wrap.appendChild(grid);
    box.appendChild(wrap);
  }
  renderDescs();if(focusedPermission)[...document.querySelectorAll('.permission-toggle')].find(el=>el.dataset.permissionId===focusedPermission)?.focus({preventScroll:true});
}

function renderDescs(){
  const sec = document.getElementById("descSec");
  const list = document.getElementById("descList");
  list.innerHTML = "";
  if(!permSelected.length){ sec.style.display = "none"; return; }
  sec.style.display = "";
  const en = permLang === "en";
  permSelected.forEach(pid => {
    const p = permById(pid);
    if(!p) return;
    const keys = iosKeysOf(p);
    const label = keys.length
      ? keys.map(k => k.key).join(" / ")
      : ((p.android && p.android.manifest) || "无需声明");
    const row = document.createElement("div");
    row.className = "descrow";
    // 默认文案：当前语言下 用户已改过 > 内置默认 > 另一语言 用户已改过 > 另一语言内置默认
    let def;
    if(en){
      const kEn = keys.length ? (keys.find(k=>k.desc_en) || keys[0]) : null;
      def = permDescsEn[pid] != null ? permDescsEn[pid]
            : ((kEn && kEn.desc_en) || ((p.android||{}).desc_en) || permDescs[pid] || "");
    }else{
      def = permDescs[pid] != null ? permDescs[pid]
            : ((keys[0] && keys[0].desc) || (p.android && p.android.desc) || permDescsEn[pid] || "");
    }
    row.innerHTML =
      '<span class="lbl">' + escapeHtml(en ? (p.name_en || p.id) : p.name) + '</span>' +
      '<input type="text" value="' + escapeHtml(def) + '" placeholder="' +
        (en ? "Describe the purpose in English" : "填写用途描述") + '">' +
      '<span style="font-size:11px;color:var(--text-3);flex:0 0 auto">' + escapeHtml(label) + "</span>";
    const input = row.querySelector("input");
    input.addEventListener("input", () => {
      if(en) permDescsEn[pid] = input.value;
      else permDescs[pid] = input.value;
      permDirty = true;
      refreshPermGen();
    });
    list.appendChild(row);
  });
  document.getElementById("langHint").textContent = en
    ? "English strings are used in the generated privacy policy and the English document. "
      + "Leave a field empty to fall back to the built-in wording."
    : "中文文案用于生成的中文隐私政策与 Info.plist；英文版请切到 English 标签填写。";
}

function refreshPermissionVisibilityNote(){
 const el=document.getElementById('permissionFilterNote');if(!el||!DATA)return;
 PermissionVisibility.annotate(DATA.sections,PERMISSION_RULES);
 const rows=DATA.sections.flatMap(s=>s.blocks).filter(b=>b.type==='item'&&b.permissionRule&&condOk(b.cond));
 const visible=rows.filter(b=>PermissionVisibility.visible(b.permissionRule,permSelected,EMBEDDED_PROFILES)).length;
 el.textContent='权限筛选：'+visible+' 项核对适用，'+(rows.length-visible)+' 项因未选对应权限隐藏。权限改动自动保存。';
}
async function refreshPermGen(){
  const body = {selected: permSelected, descs: permDescs, descsEn: permDescsEn, lang: permLang};
  let cfg = null;
  try{
    const r = await boardFetch("/api/perm-config", {
      method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)
    });
    cfg = await r.json();
  }catch(e){
    cfg = genLocally();
  }
  if(!cfg) return;
  refreshPermissionVisibilityNote();
  document.getElementById("gen-ios").textContent =
    "<dict>\n" + (cfg.iosPlist || "    <!-- 无需添加权限声明 -->") + "\n</dict>";
  document.getElementById("gen-android").textContent =
    cfg.androidManifest || "<!-- 无需添加权限声明 -->";
  document.getElementById("gen-policy").textContent =
    cfg.privacyPolicy || "_当前选中的权限无需在隐私政策中单独说明。_";

  const as = document.getElementById("gen-appstore");
  as.innerHTML = "";
  if(cfg.appstore && cfg.appstore.length){
    cfg.appstore.forEach(l => {
      const li = document.createElement("li");
      li.textContent = "☐ " + l;
      as.appendChild(li);
    });
  }else{
    const li = document.createElement("li");
    li.textContent = "未选择任何数据类型（若 App 仅使用 localStorage，可选择「不收集数据」）";
    as.appendChild(li);
  }

  const ck = document.getElementById("gen-checks");
  ck.innerHTML = "";
  if(cfg.checks && cfg.checks.length){
    cfg.checks.forEach(c => {
      const li = document.createElement("li");
      li.textContent = c;
      ck.appendChild(li);
    });
 }else{
    const li = document.createElement("li");
    li.textContent = "无";
    ck.appendChild(li);
  }

  const warn = document.getElementById("permWarn");
  if(cfg.missing && cfg.missing.length){
    warn.classList.remove("hidden");
    warn.innerHTML = "⚠️ " + cfg.missing.map(escapeHtml).join("；");
  }else{
    warn.classList.add("hidden");
  }

  document.getElementById("permHint").textContent =
    permSelected.length ? ("已选 " + permSelected.length + " 项权限") : "尚未选择权限";

  refreshEnPreview();

  schedulePermSave();
}

/* 刷新英文文档预览 */
async function refreshEnPreview(){
  const box = document.getElementById("enPreview");
  if(!box) return;
  try{
    const r = await boardFetch("/api/perm-en-preview", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({selected: permSelected, descsEn: permDescsEn})
    });
    const d = await r.json();
    if(d.error){ box.textContent = "英文文档生成失败：" + d.error; return; }
    const doc = d.doc || "";
    const lines = doc.split("\n");
    const ph = (doc.match(/\[[A-Z][A-Z0-9 /\-\.]*\]/g) || []).filter((v,i,a)=>a.indexOf(v)===i);

    // 展示头部 + Part 3 权限文案段（用户最关心自己改的部分）
    const head = lines.slice(0, 14).join("\n");
    let p3 = "";
    const i3 = lines.findIndex(l => l.indexOf("## Part 3") === 0);
    if(i3 >= 0) p3 = lines.slice(i3, i3 + Math.min(40, lines.length - i3)).join("\n");

    box.textContent =
      "共 " + lines.length + " 行 · " + permSelected.length + " 项权限 · " + ph.length + " 个待填占位符\n\n" +
      "──── 文档开头 ────\n" + head + "\n\n" +
      "──── Part 3 权限文案（你改的内容在这里）────\n" + (p3 || "（无）") + "\n\n" +
      "完整内容请点「导出英文文档」";
  }catch(e){
    box.textContent = "英文文档预览不可用（离线模式）";
  }
}

/* 离线兜底：本地生成（与服务端逻辑保持一致的核心部分） */
function genLocally(){
  const ios = [], android = [], appstore = [], policy = [], checks = [], missing = [];
  const en = permLang === "en";
  permSelected.forEach(pid => {
    const p = permById(pid);
    if(!p) return;
    iosKeysOf(p).forEach(k => {
      const d = en
        ? (permDescsEn[pid] != null ? permDescsEn[pid] : (k.desc_en || permDescs[pid] || ""))
        : (permDescs[pid] != null ? permDescs[pid] : (k.desc || permDescsEn[pid] || ""));
      if(!d.trim()) missing.push(p.name + "：缺少用途描述");
      ios.push("<key>" + escapeHtml(k.key) + "</key>\n<string>" + escapeHtml(d) + "</string>");
    });
    const a = p.android || {};
    if(a.manifest){
      android.push('<uses-permission android:name="' + a.manifest + '" />');
      checks.push("〔" + p.name + "〕Android " + (a.runtime ? "运行时权限，需动态申请" : "普通权限"));
    }
    ((p.ios || {}).appstore_labels || []).forEach(l => {
      const cn = ((PROFILES.appstore_data_types || []).find(t => t.en === l) || {}).name || l;
      const entry = cn + "（" + l + "）";
      if(!appstore.includes(entry)) appstore.push(entry);
    });
    const pname = en ? (p.name_en || p.id) : p.name;
    const ptext = en ? (p.policy_text_en || p.policy_text) : p.policy_text;
    if(ptext) policy.push("- **" + pname + "**：" + ptext);
    const notes = en ? (p.review_notes_en || p.review_notes) : p.review_notes;
    (notes || []).forEach(n => checks.push("〔" + pname + "〕" + n));
  });
  return {iosPlist: ios.join("\n"), androidManifest: android.join("\n"),
          appstore, privacyPolicy: policy.join("\n"), checks, missing};
}

async function openPermPanel(){
  permFocusReturn=document.activeElement;
  await loadProfiles();
  document.getElementById("permHint").textContent = "权限资料待逐项核验；请核对目标平台版本与官方文档。";
  // 预填：优先服务端记录的面板状态（选中项 + 中英文自定义描述）
  if(!permSelected.length){
    try{
      const r = await boardFetch("/api/list");
      const d = await r.json();
      if(d.permSelected && d.permSelected.length) permSelected = d.permSelected.slice();
      if(d.permDescs && Object.keys(d.permDescs).length) permDescs = Object.assign({}, d.permDescs);
      if(d.permDescsEn && Object.keys(d.permDescsEn).length) permDescsEn = Object.assign({}, d.permDescsEn);
    }catch(e){
      // 离线：退回构建时嵌入的快照
      if(EMBEDDED && EMBEDDED.permSelected && EMBEDDED.permSelected.length){
        permSelected = EMBEDDED.permSelected.slice();
        if(EMBEDDED.permDescs) permDescs = Object.assign({}, EMBEDDED.permDescs);
        if(EMBEDDED.permDescsEn) permDescsEn = Object.assign({}, EMBEDDED.permDescsEn);
      }
    }
  }
  renderScenarios();
  renderPerms();
  refreshPermGen();
  document.getElementById("permPanel").classList.add("on");
  document.getElementById("permClose").focus();
}
function closePermPanel(){
  document.getElementById("permPanel").classList.remove("on");
  if(permFocusReturn&&permFocusReturn.isConnected)window.BoardForms?BoardForms.returnFocus(permFocusReturn):permFocusReturn.focus();
  permFocusReturn=null;
}

document.getElementById("btnPerm").addEventListener("click", openPermPanel);
document.getElementById("permClose").addEventListener("click", closePermPanel);
document.getElementById("permCancel").addEventListener("click", closePermPanel);

/* 用途描述语言切换 */
document.getElementById("langTabs").addEventListener("click", e => {
  const btn = e.target.closest(".langtab");
  if(!btn) return;
  permLang = btn.dataset.lang;
  document.querySelectorAll("#langTabs .langtab").forEach(b => b.classList.toggle("on", b === btn));
  renderPerms();     // 权限卡片上的提示语也跟着切换
  refreshPermGen();
});

/* 导出英文文档 */
document.getElementById("permEn").addEventListener("click", async () => {
  if(!online){ toast("离线模式无法写入文件，请启动本地服务"); return; }
  try{
    const d = await api("/api/perm-write-en", {selected: permSelected, descsEn: permDescsEn});
    if(window.RELEASE_CLOUD){ const link = document.createElement("a"); const url = URL.createObjectURL(new Blob([d.doc], {type:"text/markdown;charset=utf-8"})); link.href=url; link.download=d.path; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    toast("已生成 " + d.path + "（" + d.lines + " 行）");
  }catch(e){
    toast("生成失败：" + e.message);
  }
});
document.getElementById("permPanel").addEventListener("click", e => {
  if(e.target === document.getElementById("permPanel")) closePermPanel();
});
document.getElementById("permPanel").addEventListener("keydown",e=>trapDialogFocus(document.getElementById("permPanel"),e));
document.addEventListener("keydown", e => {
  if(e.key === "Escape" && document.getElementById("permPanel").classList.contains("on")){
    closePermPanel();
  }
});

/* 复制生成结果 */
document.getElementById("permPanel").addEventListener("click", async e => {
  const btn = e.target.closest(".copy");
  if(!btn) return;
  const el = document.getElementById(btn.dataset.copy);
  if(!el) return;
  try{
    await navigator.clipboard.writeText(el.textContent);
    toast("已复制到剪贴板");
  }catch(err){
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    toast("已选中文本，请按 Cmd+C 复制");
  }
});

/* 写入 md 附录 */
/* --------------------------------------------------------------
 * 权限改动 -> 自动写入 md 附录（防抖）
 * 之前必须手动点「写入 md 附录」，容易忘 —— 附录因此长期是旧的。
 * 现在改完 0.9 秒自动落盘，面板底部实时显示保存状态。
 * -------------------------------------------------------------- */
let permSaveTimer = null;
function setPermSaveState(kind, text){
  const el = document.getElementById("permSaveState");
  if(!el) return;
  el.className = "savestate " + kind;
  el.textContent = text || "";
}
function schedulePermSave(){
  updateSaveStatus();
  if(!permDirty) return;               // 打开面板时的初始预览不算改动
  if(!online){
    setPermSaveState("offline", "离线模式：改动只在本机，不会写入文件");
    return;
  }
  setPermSaveState("saving", "正在写入 md…");
  clearTimeout(permSaveTimer);
  permSaveTimer = setTimeout(async () => {
    try{
      const d = await api("/api/perm-write", {
        selected: permSelected, descs: permDescs, descsEn: permDescsEn
      });
      permDirty = false;
      setPermSaveState("saved", "✓ 已写入 md 附录");
      DATA = mergeItems(d);
      render();
    }catch(e){
      setPermSaveState("error", "写入失败：" + e.message);
    }
  }, 900);
}

document.getElementById("permSave").addEventListener("click", async () => {
  if(!online){ toast("离线模式无法写入文件，请启动本地服务"); return; }
  if(!permSelected.length){
    const ok = await askConfirm({
      title:"清空权限配置？",
      icon:"warn", danger:true,
      body:"当前未选择任何权限，写入后会<b>清空 md 附录中的权限配置</b>（清单条目不受影响）。",
      confirmText:"确认清空", cancelText:"取消"
    });
    if(!ok) return;
  }
  try{
    const d = await api("/api/perm-write", {selected: permSelected, descs: permDescs, descsEn: permDescsEn});
    toast("已写入 md 附录（已自动备份原文件）");
    closePermPanel();
    baseRevision = d.revision;
    gen = d.generation;
    DATA = mergeItems(d);
    render();
  }catch(e){
    toast("写入失败：" + e.message);
  }
});

