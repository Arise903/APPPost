// @include release_analysis.js
// @include release_readiness.js
// @include board/modules.js
// @include board/details.js
// @include board/experience.js
// Cloud instances scope every request, draft and guide to its project.
function boardFetch(path, options){
  const cloud = window.RELEASE_CLOUD;
  if(cloud && typeof path === "string" && path.startsWith("/api/")){
    path = "/api/projects/" + encodeURIComponent(cloud.projectId) + path.slice(4);
    options = Object.assign({}, options);
    options.headers = Object.assign({}, options.headers, {"X-CSRF-Token":cloud.csrf});
  }
  return window.fetch(path, options);
}
/* ------------------------------------------------------------------ *
 * 状态
 * ------------------------------------------------------------------ */
let saveConflict=false;
let savingOperations=0, saveFailure="", localDraftFailure="", lastSavedAt=EMBEDDED.updatedAt||null;
function featureHasChanges(){return typeof featureSnapshot!=="undefined" && featureSnapshot && ['hasAccountSystem','targetMinors','hasFeedbackSystem','hasSubscriptions','hasPush','hasAdjust','hasAnalysisApi'].some(key=>!!featureSnapshot[key]!==!!DATA.features[key]);}
function updateSaveStatus(){
 const el=document.getElementById("saveStatus");if(!el)return;
 const permissionPending=typeof permDirty!=="undefined"&&permDirty;
 const extraPending=boardPendingDetails();
 const pending=extraPending.length>0||(typeof dirty!=="undefined"&&dirty)||featureHasChanges()||permissionPending;
 let label=saveConflict?"其他标签页已更新 · 请查看冲突差异":saveFailure?"保存失败 · "+saveFailure:localDraftFailure?localDraftFailure:(savingOperations>0||(typeof queuedWrites!=='undefined'&&queuedWrites>0))?"保存中…":pending?"有未保存修改":lastSavedAt?"已保存 · "+new Date(lastSavedAt).toLocaleString():"尚无待保存修改";
 if(pending&&extraPending.length)label+=' · '+extraPending.join('、');
 el.textContent=label;el.dataset.state=saveConflict||saveFailure||localDraftFailure?'error':savingOperations?'saving':pending?'pending':'saved';
 const mobile=document.getElementById("mobileStatus");if(mobile)mobile.textContent=label;
 const save=document.getElementById("mobileSave");if(save)save.disabled=savingOperations>0||!online;
 window.BoardRecovery?.refresh();
}
let baseRevision = EMBEDDED.revision;
let serverBaseline = {};
let reviewData = EMBEDDED.review || {release:{},items:{},history:[]};
let DATA = null;          // 服务端返回的最新数据
let state = {};           // id -> "done" | "skip" | "todo"
let filter = "all";
let query = "";
let sectionFilter = "all";
let dirty = false;        // 有未保存的改动
let online = false;       // 是否连上本地服务
let gen = 0;              // 世代号
let ORDER = [];           // 按全文顺序排列的条目 id
const GUIDE_KEY = "app-guide-ack" + (window.RELEASE_CLOUD ? ":" + window.RELEASE_CLOUD.userId + ":" + window.RELEASE_CLOUD.projectId : "");
const LS_KEY = "app-release-checklist-state-v2:" + (window.RELEASE_CLOUD ? window.RELEASE_CLOUD.userId + ":" + window.RELEASE_CLOUD.projectId : EMBEDDED.mdName);

function st(id){ return state[id] || "todo"; }
function isResolved(id){ const s = st(id); return s === "done" || s === "skip"; }

function loadState(g){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return {};
    const o = JSON.parse(raw);
    if(o && typeof o === "object" && o.__gen !== undefined && o.__gen !== g) return {};
    if(o.revision) baseRevision = o.revision;
    return (o && o.state) ? o.state : o;
  }catch(e){ return {}; }
}
function saveState(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify({__gen: gen, state: state, revision: baseRevision})); localDraftFailure=""; return true; }
  catch(e){ localDraftFailure="本机草稿保存失败。请勿关闭页面，并尽快导出项目备份。"; updateSaveStatus(); return false; }
}

/* ------------------------------------------------------------------ *
 * 通用确认对话框（Promise）
 * ------------------------------------------------------------------ */
const ov = document.getElementById("ov");
let dlgResolve = null;
let dlgOnOk = null;
let dlgFocusReturn = null;

function askConfirm(opts){
  // opts: {title, icon:'warn'|'danger'|'info', body(html), detail, confirmText, cancelText,
  //        danger:bool, checkText, needCheck:bool}
  return new Promise(resolve => {
    document.getElementById("dlgTitle").textContent = opts.title;
    document.getElementById("dlgBody").innerHTML = opts.body;
    const ic = document.getElementById("dlgIcon");
    ic.className = "dlg-icon " + (opts.icon || "warn");
    ic.textContent = opts.icon === "danger" ? "!" : (opts.icon === "info" ? "i" : "?");

    const det = document.getElementById("dlgDetail");
    if(opts.detail){ det.classList.remove("hidden"); det.textContent = opts.detail; }
    else det.classList.add("hidden");

    const cw = document.getElementById("dlgCheckWrap");
    const ck = document.getElementById("dlgCheck");
    if(opts.needCheck){
      cw.classList.remove("hidden");
      cw.classList.remove("locked");
      ck.checked = false;
      document.getElementById("dlgCheckText").textContent = opts.checkText || "我确认此操作";
      document.getElementById("dlgOk").disabled = true;
    }else{
      cw.classList.add("hidden");
      document.getElementById("dlgOk").disabled = false;
    }

    const ok = document.getElementById("dlgOk");
    ok.textContent = opts.confirmText || "确定";
    ok.className = "btn " + (opts.danger ? "danger" : "primary");
    document.getElementById("dlgCancel").textContent = opts.cancelText || "取消";

    dlgFocusReturn = document.activeElement;
    dlgResolve = resolve;
    dlgOnOk = opts.onOk || null;
    ov.classList.add("on");
    setTimeout(() => document.getElementById("dlgCancel").focus(), 40);
  });
}
function closeDialog(result){
  ov.classList.remove("on");
  const r = dlgResolve; dlgResolve = null;
  const cb = dlgOnOk; dlgOnOk = null;
  if(r) r(result);
  const focus = dlgFocusReturn; dlgFocusReturn = null;
  if(focus && focus.isConnected && typeof focus.focus === "function") setTimeout(() => focus.focus(), 0);
}
function trapDialogFocus(container,e){
  if(e.key!=="Tab")return;
  const controls=[...container.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href],[tabindex]:not([tabindex=\"-1\"])")].filter(el=>el.getClientRects().length);
  if(!controls.length)return;
  const first=controls[0],last=controls[controls.length-1];
  if(e.shiftKey&&(document.activeElement===first||!container.contains(document.activeElement))){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&(document.activeElement===last||!container.contains(document.activeElement))){e.preventDefault();first.focus();}
}
document.getElementById("dlgCancel").addEventListener("click", () => closeDialog(false));
document.getElementById("dlgOk").addEventListener("click", () => {
  if(document.getElementById("dlgOk").disabled) return;
  const cb = dlgOnOk;
  closeDialog(true);
  if(cb) cb();
});
document.getElementById("dlgCheck").addEventListener("change", e => {
  document.getElementById("dlgOk").disabled = !e.target.checked;
});
ov.addEventListener("click", e => { if(e.target === ov) closeDialog(false); });
ov.addEventListener("keydown", e => trapDialogFocus(ov,e));
document.addEventListener("keydown", e => {
  if(e.key === "Escape" && ov.classList.contains("on")) closeDialog(false);
});

/* ------------------------------------------------------------------ *
 * toast
 * ------------------------------------------------------------------ */
let toastTimer = null;
function toast(msg, actionText, action){
  document.getElementById("toastMsg").textContent = msg;
  const ab = document.getElementById("toastAct");
  if(actionText){
    ab.textContent = actionText;
    ab.style.display = "";
    ab.onclick = () => { action(); document.getElementById("toast").classList.remove("show"); };
  }else{
    ab.style.display = "none";
    ab.onclick = null;
  }
  document.getElementById("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), actionText ? 8000 : 2600);
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function inline(s){
  let t = esc(s);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/~~(.+?)~~/g, "<del>$1</del>");
  return t;
}
function matchQuery(text){
  if(!query) return true;
  return String(text).toLowerCase().includes(query.toLowerCase());
}
function updateItemSummary(row, details){
  const text = [details?.reason, details?.notes, details?.evidence]
    .filter(value => typeof value === "string" && value.trim()).join(" · ");
  let summary = row.querySelector(".item-evidence-summary");
  if(!text){ summary?.remove();row.classList.remove("has-records"); return; }
  if(!summary){
    summary = document.createElement("small");
    summary.className = "item-evidence-summary";
    row.appendChild(summary);
  }
  row.classList.add("has-records");summary.textContent = text;summary.title=text;
}

function makeItem(b){
  const li = document.createElement("li");
  li.className = "item l" + (b.level||0);
  li.dataset.id = b.id;
  li.dataset.text = b.text;
  li.dataset.seq = b.seq != null ? b.seq : "";
  li.dataset.gate = (b.gate ? "1" : "0");
  if(b.gate) li.classList.add("gateitem");

  // 序号徽标
  const seq = document.createElement("span");
  seq.className = "seq";
  seq.textContent = b.seq != null ? b.seq : "";
  seq.title = b.seq != null ? ("第 " + b.seq + " 项，共 " + ORDER.length + " 项") : "";
  if(!b.gate) li.appendChild(seq);

  const lab = document.createElement("div");lab.className="item-main";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = st(b.id) === "done";cb.setAttribute("aria-label","完成："+b.text);
  lab.appendChild(cb);
  const sp = document.createElement("span");
  sp.className = "txt";
  sp.innerHTML = inline(b.text);
  const title=document.createElement("button");title.type="button";title.className="item-title";title.setAttribute("aria-label","查看详情："+b.text);title.append(sp);title.onclick=()=>openItemReview(b);lab.appendChild(title);
  li.appendChild(lab);

  const actions = document.createElement("div");
  actions.className = "item-actions";const status=document.createElement("span");status.className="item-status";actions.append(status);
  li.appendChild(actions);

  // 锁定提示
  const lock = document.createElement("span");
  lock.className = "lockbadge";
  lock.textContent = "需先完成前项";
  actions.appendChild(lock);

  // 跳过按钮
  const sb = document.createElement("button");
  sb.type = "button";
  sb.className = "skipbtn";
  sb.dataset.act = "skip";
  sb.dataset.id = b.id;
  actions.appendChild(sb);
  const note = document.createElement("button");
  note.className = "btn";
  note.type = "button";
  note.textContent = "详情";note.classList.add("item-detail");note.setAttribute("aria-label","详情 · 备注 / 证据");
  note.onclick = () => openItemReview(b);
  actions.appendChild(note);
  updateItemSummary(li, reviewData.items?.[b.id]);

  return li;
}

/* 计算每一条的锁定状态：只要前面还有未处理的条目，后面全部锁定 */
function computeLocks(){
  const lis = document.querySelectorAll("li.item");
  let blocked = false;
  let firstOpen = null;
  lis.forEach(li => {
    const id = li.dataset.id;
    const resolved = isResolved(id);
    const isGate = li.dataset.gate === "1";

    // 门禁项独立于顺序链：它就是「解锁条件」，始终可操作
    if(isGate){
      li.dataset.locked = "0";
      li.dataset.gateLocked = "0";
      return;
    }

    if(!resolved && !blocked){
      blocked = true;
      firstOpen = id;
    }
    // 门禁未确认时，除门禁项外全部锁定
    if(!gateDone){
      li.dataset.locked = "1";
      li.dataset.gateLocked = "1";
      return;
    }
    li.dataset.gateLocked = "0";
    li.dataset.locked = (!resolved && blocked && firstOpen !== id) ? "1" : "0";
  });
  return firstOpen;
}
function makeTable(b){
  const t = document.createElement("table");
  b.rows.forEach((row, ri) => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const c = document.createElement(ri === 0 ? "th" : "td");
      c.innerHTML = inline(cell);
      tr.appendChild(c);
    });
    t.appendChild(tr);
  });
  return t;
}
function fillBlocks(el, blocks){
  let ul = null, bul = null, ord = null;
  for(const b of blocks){
    if(b.hiddenByPermission || (b.type === "item" && b.visible === false)) continue;
    if(b.type === "h3"){
      if(b.hiddenHead){ ul = null; bul = null; ord = null; continue; }
      const h3 = document.createElement("h3");
      h3.textContent = b.displayTitle || b.title;
      el.appendChild(h3);
      ul = null; bul = null; ord = null;
    }else if(b.type === "h4"){
      if(b.hiddenHead){ ul = null; bul = null; ord = null; continue; }
      const h4 = document.createElement("h4");
      h4.textContent = b.displayTitle || b.title;
      el.appendChild(h4);
      ul = null; bul = null; ord = null;
    }else if(b.type === "item"){
      if(!ul){ ul = document.createElement("ul"); el.appendChild(ul); }
      ul.appendChild(makeItem(b));
    }else if(b.type === "bullet"){
      if(!bul){ bul = document.createElement("ul"); bul.className = "bullets"; el.appendChild(bul); }
      const li = document.createElement("li");
      li.className = "l" + (b.level||0);
      li.innerHTML = inline(b.text);
      bul.appendChild(li);
    }else if(b.type === "ordered"){
      if(!ord){ ord = document.createElement("ol"); ord.className = "ordered"; el.appendChild(ord); }
      const li = document.createElement("li");
      li.className = "l" + (b.level||0);
      li.innerHTML = inline(b.text);
      ord.appendChild(li);
    }else if(b.type === "note"){
      const d = document.createElement("div");
      d.className = "note";
      d.innerHTML = inline(b.text);
      el.appendChild(d);
    }else if(b.type === "para"){
      const p = document.createElement("p");
      p.className = "para";
      p.innerHTML = inline(b.text);
      el.appendChild(p);
    }else if(b.type === "code"){
      const pre = document.createElement("pre");
      pre.textContent = b.lines.join("\n");
      el.appendChild(pre);
    }else if(b.type === "table"){
      el.appendChild(makeTable(b));
    }
  }
}
function build(){
  // Every entry point must apply visibility before touching the DOM.
  applyFeatures();
  const list = document.getElementById("list");
  list.innerHTML = "";
  document.getElementById("ttl").textContent = DATA.title;

  // preamble 为空时不渲染独立卡片（避免多出一块占空间）
  const preBlocks = DATA.preamble || [];
  if(preBlocks.length){
    const pre = document.createElement("section");
    pre.className = "card";
    const ph = document.createElement("h2");
    ph.textContent = "说明";
    pre.appendChild(ph);
    fillBlocks(pre, preBlocks);
    list.appendChild(pre);
  }

  const isGateSection = sec => (sec.blocks || []).some(b => b.type === "item" && b.gate);
  const orderedSections = [...DATA.sections.filter(isGateSection), ...DATA.sections.filter(sec => !isGateSection(sec))];
  for(const sec of orderedSections){
    // 「怎么用」这一节只作独立说明页的内容源，不在看板首页重复展示
    if(sec.guide_only) continue;
    if(/^附录[：:]\s*权限与隐私配置/.test(sec.title.trim()) && !(DATA.permSelected || []).length) continue;
    // 条件不满足的条目不渲染；整节都没有可见条目时连标题一起隐藏
    const secItems = (sec.blocks || []).filter(b => b.type === "item");
    const visItems = secItems.filter(b => b.visible !== false);
    if(secItems.length > 0 && visItems.length === 0) continue;
    const blocks = (sec.blocks || []).filter(b => !(b.type === "item" && b.visible === false));
    const el = document.createElement("section");
    el.className = "card";
    el.dataset.sec = sec.id;

    if(sec.collapsible){
      // 可折叠章节：默认收起成一���摘要条，展开后显示全文
      el.classList.add("collapsed");
      const bar = document.createElement("div");
      bar.className = "cbar";
      bar.setAttribute("role", "button");
      bar.setAttribute("tabindex", "0");
      const ic = document.createElement("span");
      ic.className = "carrow";
      ic.textContent = "›";
      const tx = document.createElement("span");
      tx.className = "ctitle";
      tx.textContent = sec.title;
      const hint = document.createElement("span");
      hint.className = "chint";
      hint.textContent = "使用说明 · 点击展开";
      const tg = document.createElement("span");
      tg.className = "ctoggle";
      tg.textContent = "展开";
      bar.appendChild(ic); bar.appendChild(tx); bar.appendChild(hint); bar.appendChild(tg);
      const toggle = () => {
        const open = el.classList.toggle("open");
        el.classList.toggle("collapsed", !open);
        ic.textContent = open ? "⌄" : "›";
        tg.textContent = open ? "收起" : "展开";
        if(!open) window.scrollTo({top:0, behavior:"smooth"});
      };
      bar.addEventListener("click", toggle);
      bar.addEventListener("keydown", e => {
        if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); }
      });
      el.appendChild(bar);
      const body = document.createElement("div");
      body.className = "cbody";
      const h2 = document.createElement("h2");
      h2.textContent = isGateSection(sec) ? "使用前确认 · 已了解使用说明" : sec.title;
      body.appendChild(h2);
      fillBlocks(body, sec.blocks);
      el.appendChild(body);
    }else{
      const h2 = document.createElement("h2");
      h2.textContent = isGateSection(sec) ? "使用前确认 · 已了解使用说明" : sec.title;
      el.appendChild(h2);
      fillBlocks(el, blocks);
    }
    list.appendChild(el);
  }

  // 按 DOM 顺序建立全局执行顺序
  ORDER = [...document.querySelectorAll("li.item")].map(li => li.dataset.id);
  window.BoardWorkspace?.afterBuild();
}

/* --------------------------------------------------------------
 * 项目特征：决定哪些条目显示
 *   hasAccountSystem=0 -> 隐藏「账号注册 / 注销」相关条目
 *   targetMinors=0      -> 隐藏「儿童 / 未成年人保护」相关条目
 * 隐藏后剩余条目重新连续编号（不留空洞）。
 * -------------------------------------------------------------- */
function condOk(cond){
  if(!cond) return true;
  const f = (DATA && DATA.features) || {};
  if(cond === "hasFeedbackSystem" || cond === "hasPush") return f[cond] === true;
  return f[cond] !== false;      // 未声明的特性按「启用」处理（保守，不漏检）
}
function applyFeatures(){
  if(!DATA) return;
  ensureFeatureModules();
  PermissionVisibility.annotate(DATA.sections, PERMISSION_RULES);
  let n = 0;
  const walk = blocks => {
    (blocks || []).forEach(b => {
      if(b.type !== "item") return;
      if(b.gate){ b.visible = true; b.seq = ""; return; }
      b.visible = PermissionVisibility.platformVisible(b,reviewData.release?.platform) && condOk(b.cond) && PermissionVisibility.visible(b.permissionRule, DATA.permSelected || [], EMBEDDED_PROFILES);
      if(b.visible){ n++; b.seq = n; } else { b.seq = ""; }
    });
  };
  walk(DATA.preamble);
  (DATA.sections || []).forEach(s => walk(s.blocks));

  // 小节标题（h3/h4）：若其下所有条目都被隐藏，标题也跟着隐藏，
  // 否则会留下一个空标题（如「5.4 账号注销与数据主体权利」）
  (DATA.sections || []).forEach(s => {
    const bl = s.blocks || [];
    for(let i = 0; i < bl.length; i++){
      const b = bl[i];
      if(b.type !== "h3" && b.type !== "h4") continue;
      let j = i + 1, has = false, vis = false;
      while(j < bl.length && bl[j].type !== "h3" && bl[j].type !== "h4"){
        if(bl[j].type === "item"){ has = true; if(bl[j].visible !== false) vis = true; }
        j++;
      }
      b.hiddenHead = has && !vis;
      for(let k=i+1;k<j;k++){ if(bl[k].type !== "item") bl[k].hiddenByPermission = b.hiddenHead; }
    }
  });
  // Display-only numbering: keep original titles and IDs stable for saved records.
  for(const section of DATA.sections || []){
    let top = 0, parent = null, children = 0;
    const dotted = {};
    for(const block of section.blocks || []){
      if(block.type !== "h3" && block.type !== "h4") continue;
      block.displayTitle = block.title;
      if(block.hiddenHead) continue;
      const match = block.title.match(/^(\d+)(?:\.(\d+))?([.、]?\s+)(.*)$/);
      if(!match) continue;
      if(block.type === "h3"){
        children = 0;
        if(match[2]){
          dotted[match[1]] = (dotted[match[1]] || 0) + 1;
          parent = match[1] + "." + dotted[match[1]];
          block.displayTitle = parent + " " + match[4];
        }else{
          parent = String(++top);
          block.displayTitle = parent + ". " + match[4];
        }
      }else if(match[2]){
        block.displayTitle = (parent || match[1]) + "." + (++children) + " " + match[4];
      }
    }
  }
  DATA.visibleTotal = n;
}
function hiddenItems(){
  const out = [];
  if(!DATA) return out;
  (DATA.sections || []).forEach(s => (s.blocks || []).forEach(b => {
    if(b.type === "item" && b.visible === false) out.push(b);
  }));
  return out;
}

function featureHiddenItems(){
  const keys = ["hasAccountSystem", "hasFeedbackSystem", "targetMinors", "hasSubscriptions", "hasPush", "hasAdjust", "hasAnalysisApi"];
  return hiddenItems().filter(it => keys.includes(it.cond) && !condOk(it.cond));
}

/* 渲染前的结构指纹：基于 DATA 计算（章节标题 + 可见条目 id 序列 + 项目特征
   + 非条目内容指纹）。附录等说明章节没有条目，若只比条目 id，
   权限面板写入后附录内容变了也不会触发重渲染 —— 所以把表格/代码等
   非条目块也算进指纹。 */
function hashStr(s){
  let h = 0;
  for(let i = 0; i < s.length; i++){ h = (h * 31 + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}
function structureKey(){
  const feats = JSON.stringify((DATA && DATA.features) || {});
  const heads = (DATA.sections || []).map(s => s.title).join("|");
  const ids = [];
  const others = [];
  const walk = blocks => {
    (blocks || []).forEach(b => {
      if(b.type === "item"){
        if(b.visible !== false) ids.push(b.id);
      }else{
        others.push(b);
      }
    });
  };
  for(const sec of DATA.sections || []) walk(sec.blocks);
  walk(DATA.preamble);
  return JSON.stringify(DATA.permSelected || []) + "#" + feats + "#" + heads + "#" + ids.join(",") + "#" + hashStr(JSON.stringify(others));
}

/* 若结构未变则不重建 DOM，只刷新状态。
   重建会让用户已经捕获的 DOM 引用失效（委托事件不再冒泡），
   导致加载期间的点击丢失，所以只在内容真正变化时才重建。 */
function render(){
  applyFeatures();
  const key = structureKey();
  if(key === lastStructureKey){
    refreshAll();
    return false;
  }
  build();
  lastStructureKey = key;
  refreshAll();
  return true;
}
let lastStructureKey = "";
function applyFilter(){
  let visible = 0;
  document.querySelectorAll("li.item").forEach(li => {
    const s = st(li.dataset.id);
    let show = true;
    if(filter === "todo") show = s === "todo";
    else if(filter === "done") show = s === "done";
    else if(filter === "skip") show = s === "skip";
    if(show) show = matchQuery(li.dataset.text);
    if(show && sectionFilter !== "all") show = li.closest("section.card")?.dataset.sec === sectionFilter;
    li.classList.toggle("hidden", !show);
    if(show) visible++;
  });
  document.querySelectorAll("section.card").forEach(sec => {
    if(!sec.querySelector("li.item")){ sec.classList.remove("hidden"); return; }
    sec.classList.toggle("hidden", !sec.querySelector("li.item:not(.hidden)"));
  });
  document.getElementById("empty").classList.toggle("hidden", visible !== 0);
  const fn = document.getElementById("filtNote");
  const labels = {
    all:"显示全部条目",
    todo:"仅显示未完成条目",
    done:"仅显示已完成条目",
    skip:"仅显示已跳过条目"
  };
  const activeLabels=[];
  if(filter!=="all")activeLabels.push(labels[filter]);
  if(sectionFilter!=="all")activeLabels.push("章节："+(document.getElementById("sectionFilter").selectedOptions[0]?.textContent||""));
  if(query)activeLabels.push("搜索："+query);
  fn.textContent=activeLabels.length?activeLabels.join(" · ")+"（说明性内容始终保留）":"";
  fn.classList.toggle("hidden", activeLabels.length===0);
  window.BoardWorkspace?.filterRows();
}
function refreshSectionFilter(){
  const select = document.getElementById("sectionFilter");
  if(!select || !DATA) return;
  const prior = sectionFilter;
  const sections = (DATA.sections || []).filter(sec => !sec.guide_only && (sec.blocks || []).some(b => b.type === "item" && !b.gate && b.visible !== false));
  select.replaceChildren(new Option("全部章节", "all"));
  sections.forEach(sec => {
    const items = sec.blocks.filter(b => b.type === "item" && !b.gate && b.visible !== false);
    const done = items.filter(b => st(b.id) === "done").length;
    const skipped = items.filter(b => st(b.id) === "skip").length;
    const resolved = done + skipped;
    const percent = items.length ? Math.round(done / items.length * 100) : 0;
    select.add(new Option(`${sec.title} · 已处理 ${resolved}/${items.length} · 完成率 ${percent}%`, sec.id));
  });
  if(prior !== "all" && sections.some(sec => sec.id === prior)) select.value = prior;
  else { sectionFilter = "all"; select.value = "all"; }
}
function refreshProgress(){
  const items = document.querySelectorAll("li.item");
  const checks = [...items].filter(l => l.dataset.gate !== "1");
  const total = checks.length;
  let done = 0, skip = 0, cur = null, curSeq = 0;
  checks.forEach(li => {
    const s = st(li.dataset.id);
    if(s === "done") done++;
    else if(s === "skip") skip++;
    else if(!cur){ cur = li.dataset.id; curSeq = li.dataset.seq || "?"; }
  });
  const pct = total ? Math.round(done/total*100) : 0;
  document.getElementById("pct").textContent = pct + "%";
  document.querySelector(".track[role=progressbar]").setAttribute("aria-valuenow", String(pct));
  document.getElementById("cnt").textContent =
    done + " / " + total + " 项已完成" + (skip ? " · 跳过 " + skip : "");
  document.getElementById("fill").style.width = pct + "%";
  refreshSectionFilter();

  // 门禁横幅
  const gb = document.getElementById("gateBar");
  if(gb) gb.classList.toggle("hidden", gateDone);

  // 项目设置：已隐藏条目提示
  const fp = document.getElementById("featPill");
  if(fp){
    const hidden = featureHiddenItems().length;
    fp.classList.toggle("hidden", hidden === 0);
    const fb = fp.querySelector("b");
    if(fb) fb.textContent = hidden;
  }

  // 顺序提示条（可点击跳到当前项）
  const sl = document.getElementById("seqline");
  if(!gateDone){
    sl.className = "seqline done";
    sl.innerHTML = '<span class="k">清单未解锁 · 请先阅读《使用说明》并确认</span>';
    return;
  }
  if(!cur){
    sl.className = "seqline done";
    sl.innerHTML = '<span class="k">全部条目已处理完毕' +
      (skip ? "（其中跳过 " + skip + " 项）" : "") + '</span>';
  }else{
    sl.className = "seqline";
    sl.innerHTML = '<span class="k">当前应处理</span>' +
      '<span class="n">第 ' + curSeq + ' 项</span>' +
      '<span class="k">· 后面的条目已锁定</span>' +
      '<span class="go">点击定位 ↓</span>';
  }
}

/* 跳转到当前应处理的条目 */
function jumpToCurrent(){
  // 若在筛选/搜索状态下，先切回「全部」并清空搜索
  if(filter !== "all" || query || sectionFilter !== "all"){
    filter = "all"; query = ""; sectionFilter = "all";
    document.getElementById("q").value = "";
    document.getElementById("sectionFilter").value = "all";
    document.querySelectorAll("#seg button").forEach(b => {const active=b.dataset.f==="all";b.classList.toggle("on",active);b.setAttribute("aria-pressed",String(active));});
    applyFilter();
  }
  const target = [...document.querySelectorAll("li.item")].find(l => {
    const s = st(l.dataset.id);
    return s !== "done" && s !== "skip" && l.dataset.locked === "0";
  });
  if(!target) return;
  window.BoardWorkspace?.reveal(target);
  target.scrollIntoView({block:"center", behavior:"smooth"});
  target.animate(
    [{background:"#DCEAF9"},{background:"transparent"}],
    {duration:1200, easing:"ease-out"}
  );
}
function refreshAll(){
  updateSaveStatus();
  refreshReadiness();
  // 先按顺序计算锁定，再统一应用
  const firstOpen = computeLocks();
  document.querySelectorAll("li.item").forEach(li => {
    const id = li.dataset.id;
    const s = st(id);
    const cb = li.querySelector("input[type=checkbox]");
    cb.checked = s === "done";
    cb.disabled = li.dataset.locked === "1";
    li.classList.toggle("done", s === "done");
    li.classList.toggle("skip", s === "skip");
    li.classList.toggle("locked", li.dataset.locked === "1");
    li.classList.toggle("current", id === firstOpen);
    const sb = li.querySelector(".skipbtn");
    if(sb){
      if(s === "skip"){ sb.textContent = "取消跳过"; sb.classList.add("undo"); }
      else { sb.textContent = "跳过"; sb.classList.remove("undo"); }
    }
  });
  refreshProgress();
  applyFilter();
}
function setMode(live){
  online = live;
  const m = document.getElementById("mode");
  m.classList.toggle("live", live);
  document.getElementById("modeTxt").textContent = live ? "已连接 · 可写回文件" : "离线模式 · 仅本机保存";
  document.getElementById("btnSave").disabled = !live;
}

/* ------------------------------------------------------------------ *
 * 与本地服务通信
 * ------------------------------------------------------------------ */
// @include board/persistence.js

async function loadFromServer(){
  try{
    const d = await api("/api/list");
    const changes = {};
    if(dirty) for(const k in state){ if(state[k] !== (serverBaseline[k] || "todo")) changes[k] = state[k]; }
    if(dirty && baseRevision !== d.revision) throw new Error("服务端已变化，请先导出未保存进度");
    baseRevision = d.revision;
    gen = d.generation;
    state = Object.assign(seedFromData(d), changes);
    serverBaseline = baselineFromData(d);
    baseRevision = d.revision;
    reviewData = d.review || reviewData;
    updateSummaryReleaseOptions();
    DATA = mergeItems(d);
    // 门禁状态：md 为准。
    // 只有「从未确认过」（gateState=todo）才允许用本机的离线确认记录补写，
    // 明确取消过（gateState=skip）的门禁不会被悄悄复活。
    let localAck = false;
    try{ localAck = localStorage.getItem(GUIDE_KEY) === "1"; }catch(e){}
    if(!d.gateDone && localAck && (d.gateState === "todo" || d.gateState === undefined)){
      try{
        const ackRes = await api("/api/ack", {});
        if(ackRes && ackRes.gateDone){
          d.gateDone = true;
          d.gateState = "done";
          baseRevision = ackRes.revision;
          DATA = mergeItems(ackRes);
        }
      }catch(e){}
    }
    gateDone = !!d.gateDone;
    if(d.gateId && changes[d.gateId]) gateDone = changes[d.gateId] === "done";
    if(gateDone){
      try{ localStorage.setItem(GUIDE_KEY, "1"); }catch(e){}
    }else if(d.gateState !== "skip"){
      // 从未确认过 → 清掉可能残留的本机记录
      try{ localStorage.removeItem(GUIDE_KEY); }catch(e){}
    }
    saveConflict=false;setMode(true);
    window.BoardWorkspace?.loaded();
    build();
    render();
    return true;
  }catch(e){
    setMode(false);
    if(dirty) toast("保留了本机未保存进度：" + e.message + "。请先导出摘要，再刷新处理冲突。");
    return false;
  }
}
// 服务端返回的是扁平 items，需要还原成 section/block 结构
function mergeItems(d){
  const map = {};
  d.items.forEach(it => { map[it.id] = it; });
  const em = EMBEDDED;
  const out = {
    title: d.title || (em && em.title) || "Checklist",
    preamble: [],
    sections: [],
    total: d.total != null ? d.total : ((em && em.total) || 0),
    done: d.done != null ? d.done : 0,
    skipped: d.skipped != null ? d.skipped : 0,
    mdName: d.mdName || (em && em.mdName) || "清单文件",
    permDescs:d.permDescs||em?.permDescs||{},permDescsEn:d.permDescsEn||em?.permDescsEn||{},
    assetIds:d.assetIds||em?.assetIds||[],
    permSelected: Array.isArray(d.permSelected) ? d.permSelected : ((em && em.permSelected) || []),
    features: d.features || (em && em.features) || {hasAccountSystem:true, targetMinors:true}
  };
  const secSrc = d.sections && d.sections.length ? d.sections : ((em && em.sections) || []);
  const normBlocks = blocks => (blocks || []).map(b => {
    if(b.type !== "item") return b;
    const m = map[b.id];
    return Object.assign({}, b, m ? {
      checked: m.state === "done",
      state: m.state,
      seq: b.seq != null ? b.seq : m.seq,
      gate: m.gate || b.gate || false,
      cond: m.cond || b.cond || null
    } : {cond: b.cond || null});
  });
  out.preamble = d.preamble && d.preamble.length ? normBlocks(d.preamble) : normBlocks(em && em.preamble);
  secSrc.forEach(sec => {
    // 必须带上 guide_only / collapsible 标志，否则「怎么用」章节会被误渲染
    out.sections.push({
      title: sec.title,
      id: sec.id,
      blocks: normBlocks(sec.blocks),
      guide_only: !!(sec.guide_only || (em && em.sections || []).find(s => s.id === sec.id && s.guide_only)),
      collapsible: !!(sec.collapsible || (em && em.sections || []).find(s => s.id === sec.id && s.collapsible))
    });
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * 交互
 * ------------------------------------------------------------------ */
document.getElementById("list").addEventListener("change", async e => {
  const cb = e.target;
  if(cb.type !== "checkbox") return;
  const li = cb.closest("li.item");
  const id = li.dataset.id;
  if(li.dataset.locked === "1"){
    cb.checked = false;
    toast("必须按顺序完成前面的条目");
    return;
  }
  if(li.dataset.gate === "1" && !cb.checked && gateDone){
    // Restore the checked state while the user decides, so cancelling the
    // confirmation leaves both the gate and checklist unchanged.
    cb.checked = true;
    const confirmed = await askConfirm({
      title:"取消阅读确认？",
      icon:"warn",
      body:"取消后，所有尚未完成的检查项都会重新锁定。已完成记录会保留。",
      detail:"你之后可以重新勾选阅读确认来解锁清单。",
      confirmText:"取消确认",
      cancelText:"保持已确认",
      danger:true
    });
    if(!confirmed) return;
    cb.checked = false;
  }
  state[id] = cb.checked ? "done" : "todo";
  if(li.dataset.gate === "1") gateDone = cb.checked;
  saveState();
  refreshAll();
  markDirty();
});
document.getElementById("list").addEventListener("click", e => {
  const sb = e.target.closest(".skipbtn");
  if(!sb) return;
  e.preventDefault();
  e.stopPropagation();
  const id = sb.dataset.id;
  const li = sb.closest("li.item");
  if(li.dataset.locked === "1"){
    toast("必须按顺序处理前面的条目");
    return;
  }
  if(st(id) === "skip"){
    state[id] = "todo";
  }else{
    state[id] = "skip";
  }
  saveState();
  refreshAll();
  markDirty();
});
function markDirty(){
  dirty = Object.keys({...serverBaseline,...state}).some(id=>st(id)!==(serverBaseline[id]||"todo"));
  saveFailure = "";
  updateSaveStatus();
  document.getElementById("btnSave").textContent = dirty ? "保存进度 *" : "保存进度";
}

document.getElementById("seg").addEventListener("click", e => {
  const btn = e.target.closest("button[data-f]");
  if(!btn) return;
  filter = btn.dataset.f;
  document.querySelectorAll("#seg button").forEach(b => {const active=b===btn;b.classList.toggle("on",active);b.setAttribute("aria-pressed",String(active));});
  applyFilter();
});
document.getElementById("sectionFilter").addEventListener("change", e => { sectionFilter = e.target.value || "all"; applyFilter(); });
let qt = null;
document.getElementById("q").addEventListener("input", e => {
  clearTimeout(qt);
  const v = e.target.value;
  qt = setTimeout(() => { query = v; applyFilter(); }, 120);
});

/* ---- 保存到 md ---- */
document.getElementById("btnSave").addEventListener("click", async () => {
  if(!online){ toast("当前是离线模式，无法写回文件"); return; }
  const doneCount = Object.values(state).filter(v => v === "done").length;
  const skipCount = Object.values(state).filter(v => v === "skip").length;
  const ok = window.RELEASE_PAGES || window.RELEASE_CLOUD ? true : await askConfirm({
    title:"保存勾选状态到 md 文件？",
    icon:"info",
    body:`将把当前看板上的 <strong>${doneCount}</strong> 项完成、
          <strong>${skipCount}</strong> 项跳过写回
          <strong>${DATA.mdName || "清单文件"}</strong>。<br>
          文件中原有的其他内容与格式保持不变。`,
    detail:"写回前会自动生成一份带时间戳的 .bak 备份文件。",
    confirmText:"保存",
    cancelText:"取消"
  });
  if(!ok) return;
  try{
    const changes = {};
    for(const k in state) if(state[k] !== (serverBaseline[k] || "todo")) changes[k] = state[k];
    const d = await api("/api/write", {states: changes, revision: baseRevision});
    baseRevision = d.revision;
    gen = d.generation;
    DATA = mergeItems(d);
    state = seedFromData(d);
    serverBaseline = baselineFromData(d);
    saveState();
    dirty = false;
    document.getElementById("btnSave").textContent = "保存进度";
    render();
    toast("已写回文件");
  }catch(e){
    toast("保存失败：" + e.message);
  }
});

/* ---- 导出副本（只下载，不动原文件） ---- */
document.getElementById("mExport").addEventListener("click", () => {
  const lines = [];
  lines.push("# " + DATA.title);
  lines.push("");
  lines.push("> 导出时间：" + new Date().toLocaleString("zh-CN"));
  lines.push("");
  const MARK = {done:"[x]", skip:"[-]", todo:"[ ]"};
  const walk = blocks => {
    for(const b of blocks){
      if(b.hiddenByPermission) continue;
      if(b.type === "h3"){ if(!b.hiddenHead){ lines.push("### " + (b.displayTitle || b.title)); lines.push(""); } }
      else if(b.type === "h4"){ if(!b.hiddenHead){ lines.push("#### " + (b.displayTitle || b.title)); lines.push(""); } }
      else if(b.type === "item"){
        if(b.visible === false) continue;   // 被项目特征隐藏的条目不进导出副本
        lines.push("  ".repeat(b.level||0) + "- " + (MARK[st(b.id)] || "[ ]") + " " + b.text);
      }
      else if(b.type === "bullet"){ lines.push("  ".repeat(b.level||0) + "- " + b.text); }
      else if(b.type === "ordered"){ lines.push("  ".repeat(b.level||0) + b.num + ". " + b.text); }
      else if(b.type === "note"){ lines.push("> " + b.text); lines.push(""); }
      else if(b.type === "para"){ lines.push(b.text); lines.push(""); }
      else if(b.type === "code"){ lines.push("```" + (b.lang||"")); lines.push(...b.lines); lines.push("```"); lines.push(""); }
      else if(b.type === "table"){
        b.rows.forEach((row, ri) => {
          lines.push("| " + row.join(" | ") + " |");
          if(ri === 0) lines.push("| " + row.map(()=> "---").join(" | ") + " |");
        });
        lines.push("");
      }
    }
  };
  walk(DATA.preamble || []);
  for(const sec of DATA.sections){
    if(sec.guide_only) continue;   // 使用说明不属于清单内容，不进导出副本
    lines.push("## " + sec.title); lines.push(""); walk(sec.blocks); lines.push("");
  }
  const blob = new Blob([lines.join("\n")], {type:"text/markdown;charset=utf-8"});
  const a = document.createElement("a");
  const d = new Date(); const pad = n => String(n).padStart(2,"0");
  a.href = URL.createObjectURL(blob);
  a.download = "上架前App配置清单-" + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + ".md";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("已导出副本（未修改原文件）");
});

/* ---- 清空完成状态（需二次确认） ---- */
document.getElementById("mClear").addEventListener("click", async () => {
  const total = DATA && DATA.total ? DATA.total : 0;
  const doneNow = Object.values(state).filter(v => v === "done").length;
  const skipNow = Object.values(state).filter(v => v === "skip").length;

  const ok = await askConfirm({
    title:"清空全部完成状态？",
    icon:"warn",
    danger:true,
    body:`这会把清单里所有 <strong>[x]</strong>（完成）和 <strong>[-]</strong>（跳过）
          标记还原成 <strong>[ ]</strong>，用于开始下一轮发布自查。<br><br>
          共 <strong>${total}</strong> 项，其中 <strong>${doneNow}</strong> 项已完成、
          <strong>${skipNow}</strong> 项已跳过。
          ${online ? "文件会被直接改写" : "离线模式下仅清空本机记录"}。`,
    detail:"原始文件会先自动备份为 带时间戳的 .bak 文件，误操作可从备份恢复。",
    confirmText:"继续",
    cancelText:"取消",
    needCheck:true,
    checkText:"我确认要清空全部完成状态"
  });
  if(!ok){ toast("已取消，未做任何改动"); return; }

  if(!online){
    // 离线：只清本地
    const snapshot = Object.assign({}, state);
    state = {};
    saveState();
    dirty = false;
    refreshAll();
    toast("已清空本机完成状态", "撤销", () => { state = snapshot; saveState(); refreshAll(); });
    return;
  }

  // 服务端执行
  try{
    const d = await api("/api/clear", {});
    baseRevision = d.revision;
    gen = d.generation;
    state = seedFromData(d);
    serverBaseline = baselineFromData(d);
    saveState();
    DATA = mergeItems(d);
    dirty = false;
    document.getElementById("btnSave").textContent = "保存进度";
    render();
    toast("已清空 " + d.cleared + " 处状态，并已备份原文件");
  }catch(e){
    toast("清空失败：" + e.message);
  }
});

/* ---- 离开前提醒未保存 ---- */
window.addEventListener("beforeunload", e => {
  if((dirty || featureHasChanges() || permDirty || savingOperations>0 || boardPendingDetails().length) && online){ e.preventDefault(); e.returnValue = ""; }
});

// @include board/permissions.js

/* ------------------------------------------------------------------ *
 * 更多菜单 / 快捷操作
 * ------------------------------------------------------------------ */
const moreMenu = document.getElementById("moreMenu");
const btnMore = document.getElementById("btnMore");
function closeMore(){
  moreMenu.classList.remove("on");
  btnMore.setAttribute("aria-expanded", "false");
}
btnMore.addEventListener("click", e => {
  e.stopPropagation();
  const open = moreMenu.classList.toggle("on");
  btnMore.setAttribute("aria-expanded", open ? "true" : "false");
});
moreMenu.addEventListener("click", e => {
  if(e.target.tagName === "BUTTON") closeMore();
});
document.addEventListener("click", e => {
  if(!e.target.closest(".morewrap")) closeMore();
});
document.addEventListener("keydown", e => {
  if(e.key === "Escape") closeMore();
});

/* 从「更多」菜单打开《使用说明》 */
document.getElementById("mGuide").addEventListener("click", () => {
  closeMore();
  openGuide();
});

/* 点击提示条跳到当前项 */
document.getElementById("seqline").addEventListener("click", jumpToCurrent);

// @include board/features.js

/* ---- 使用说明入口 ---- */
function openGuide(){
  // 服务端模式走 /guide（内容总是最新的），离线模式走同目录 html
  window.open(online ? (window.RELEASE_CLOUD ? "/projects/" + window.RELEASE_CLOUD.projectId + "/guide" : "/guide") : "使用说明.html", "_blank");
}
document.getElementById("btnGuide").addEventListener("click", openGuide);


/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
function normalizeState(raw){
  // 兼容旧版布尔格式：true -> done, false -> todo
  const out = {};
  if(!raw) return out;
  for(const k in raw){
    const v = raw[k];
    if(v === true) out[k] = "done";
    else if(v === false) out[k] = "todo";
    else if(v === "done" || v === "skip" || v === "todo") out[k] = v;
  }
  return out;
}
function seedFromData(d){
  // 以 md 文件里的实际标记为准，作为初始状态
  const out = {};
  (d.items || []).forEach(it => { if(it.state && it.state !== "todo") out[it.id] = it.state; });
  // Pages excludes the gate from counted items, but it still lives in the sections.
  (d.sections || []).forEach(sec => (sec.blocks || []).forEach(block => {
    if(block.type === "item" && block.gate && block.state && block.state !== "todo") out[block.id] = block.state;
  }));
  return out;
}
function baselineFromData(d){
  const baseline = Object.fromEntries((d.items || []).map(it => [it.id, it.state || "todo"]));
  (d.sections || []).forEach(sec => (sec.blocks || []).forEach(block => {
    if(block.type === "item" && block.gate) baseline[block.id] = block.state || "todo";
  }));
  return baseline;
}


// @include board/release.js

document.getElementById("mobileSave").onclick=()=>document.getElementById("btnSave").click();
document.getElementById("mobileCurrent").onclick=jumpToCurrent;
document.getElementById("mobileExport").onclick=()=>document.getElementById("releaseSummary").click();
document.getElementById("featPanel").addEventListener('click',e=>{if(e.target.id==='featPanel')closeFeatPanel();});
document.getElementById("featPanel").addEventListener('keydown',e=>trapDialogFocus(document.getElementById("featPanel"),e));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('featPanel').classList.contains('on'))closeFeatPanel();});

const newReleaseButton=document.getElementById('newRelease');
newReleaseButton.hidden=!(window.RELEASE_PAGES||window.RELEASE_CLOUD);
newReleaseButton.onclick=()=>{
 if(dirty||permDirty||featureHasChanges()||savingOperations||boardPendingDetails().length){toast('请先保存所有改动，再开始新一轮发布');return;}
 document.getElementById('newReleaseForm').reset();document.getElementById('newReleaseError').textContent='';document.getElementById('newReleaseDialog').showModal();
};
document.getElementById('cancelNewRelease').onclick=()=>document.getElementById('newReleaseDialog').close();
document.getElementById('newReleaseForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
 try{
  const release={...reviewData.release,version:form.elements.version.value.trim(),build:form.elements.build.value.trim(),date:ReleaseReadiness.calendarDate(undefined,reviewData.release?.timeZone)};
  const d=await api('/api/new-release',{release,keepNotes:form.elements.keepNotes.checked,keepEvidence:form.elements.keepEvidence.checked});
  gen=d.generation;reviewData=d.review;updateSummaryReleaseOptions();state=seedFromData(d);serverBaseline=baselineFromData(d);DATA=mergeItems(d);dirty=false;saveState();render();refreshFeatUI();document.getElementById('newReleaseDialog').close();toast('上一轮已归档，新一轮发布已开始');
 }catch(error){document.getElementById('newReleaseError').textContent=error.message;}finally{button.disabled=false;updateSaveStatus();}
};

DATA = EMBEDDED;
serverBaseline = baselineFromData(EMBEDDED);
gen = EMBEDDED.generation || 1;
state = normalizeState(loadState(gen));
// md 里已有的标记同步进来（离线模式尤其重要）
state = Object.assign(seedFromData(EMBEDDED), state);
dirty = Object.keys(state).some(k => state[k] !== (serverBaseline[k] || "todo"));
if(dirty) markDirty();
gateDone = !!(EMBEDDED.gateDone);
const embeddedGate = (EMBEDDED.sections || []).flatMap(sec => sec.blocks || []).find(block => block.type === "item" && block.gate);
if(embeddedGate && st(embeddedGate.id) === "done") gateDone = true;
// 离线兜底：本地记过一次确认
if(!gateDone){
  try{ gateDone = localStorage.getItem(GUIDE_KEY) === "1"; }catch(e){}
}
setMode(false);
applyFeatures();
build();
lastStructureKey = structureKey();
refreshAll();
refreshFeatUI();
document.getElementById("built").textContent =
  "看板生成于 " + (EMBEDDED.built || "") + " · 世代 " + gen;

loadFromServer().then(ok => {
  if(ok){
    document.getElementById("built").textContent =
      "已连接本地服务 · 世代 " + gen + " · 勾选可直接写回 md";
    toast("已连接本地服务，可直接保存到 md");
  }
});

// @include board/subscriptions.js

// @include board/workspace.js

// @include board/recovery.js

installBoardExperience();
