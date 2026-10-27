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
let savingOperations=0, saveFailure="", lastSavedAt=null;
function featureHasChanges(){return typeof featureSnapshot!=="undefined" && featureSnapshot && ['hasAccountSystem','targetMinors','hasFeedbackSystem'].some(key=>!!featureSnapshot[key]!==!!DATA.features[key]);}
function updateSaveStatus(){
 const el=document.getElementById("saveStatus");if(!el)return;
 const permissionPending=typeof permDirty!=="undefined"&&permDirty;
 const pending=(typeof dirty!=="undefined"&&dirty)||featureHasChanges()||permissionPending;
 let label=saveFailure?"保存失败 · "+saveFailure:(savingOperations>0||(typeof queuedWrites!=='undefined'&&queuedWrites>0))?"保存中…":pending?"有未保存修改":lastSavedAt?"已保存 · "+new Date(lastSavedAt).toLocaleTimeString():"尚无待保存修改";
 el.textContent=label;el.dataset.state=saveFailure?'error':savingOperations?'saving':pending?'pending':'saved';
 const mobile=document.getElementById("mobileStatus");if(mobile)mobile.textContent=label;
 const save=document.getElementById("mobileSave");if(save)save.disabled=savingOperations>0||!online;
}
let baseRevision = EMBEDDED.revision;
let serverBaseline = {};
let reviewData = EMBEDDED.review || {release:{},items:{},history:[]};
let DATA = null;          // 服务端返回的最新数据
let state = {};           // id -> "done" | "skip" | "todo"
let filter = "all";
let query = "";
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
  try{ localStorage.setItem(LS_KEY, JSON.stringify({__gen: gen, state: state, revision: baseRevision})); }catch(e){}
}

/* ------------------------------------------------------------------ *
 * 通用确认对话框（Promise）
 * ------------------------------------------------------------------ */
const ov = document.getElementById("ov");
let dlgResolve = null;
let dlgOnOk = null;

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

  const lab = document.createElement("label");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = st(b.id) === "done";
  lab.appendChild(cb);
  const sp = document.createElement("span");
  sp.className = "txt";
  sp.innerHTML = inline(b.text);
  lab.appendChild(sp);
  li.appendChild(lab);

  // 锁定提示
  const lock = document.createElement("span");
  lock.className = "lockbadge";
  lock.textContent = "需先完成前项";
  li.appendChild(lock);

  // 跳过按钮
  const sb = document.createElement("button");
  sb.type = "button";
  sb.className = "skipbtn";
  sb.dataset.act = "skip";
  sb.dataset.id = b.id;
  li.appendChild(sb);
  const note = document.createElement("button");
  note.className = "btn";
  note.type = "button";
  note.textContent = "备注 / 证据";
  note.onclick = async () => {
    if(!online){ toast("请连接服务后编辑检查记录"); return; }
    const old = (reviewData.items || {})[b.id] || {};
    const reason = prompt("跳过原因（不适用 / 暂缓 / 待他人处理，可自行填写）", old.reason || "");
    if(reason === null) return;
    const notes = prompt("检查备注", old.notes || "");
    if(notes === null) return;
    const evidence = prompt("验证证据：文件路径、截图路径或链接", old.evidence || "");
    if(evidence === null) return;
    const next = JSON.parse(JSON.stringify(reviewData));
    next.items = next.items || {};
    next.items[b.id] = {reason, notes, evidence};
    await persistReview(next);
  };
  li.appendChild(note);
  const details = (reviewData.items || {})[b.id];
  if(details){
    const small = document.createElement("small");
    small.textContent = [details.reason, details.notes, details.evidence].filter(Boolean).join(" · ");
    li.appendChild(small);
  }

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
  if(cond === "hasFeedbackSystem") return f[cond] === true;
  return f[cond] !== false;      // 未声明的特性按「启用」处理（保守，不漏检）
}
function applyFeatures(){
  if(!DATA) return;
  PermissionVisibility.annotate(DATA.sections, PERMISSION_RULES);
  let n = 0;
  const walk = blocks => {
    (blocks || []).forEach(b => {
      if(b.type !== "item") return;
      if(b.gate){ b.visible = true; b.seq = ""; return; }
      b.visible = condOk(b.cond) && PermissionVisibility.visible(b.permissionRule, DATA.permSelected || [], EMBEDDED_PROFILES);
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
  const keys = ["hasAccountSystem", "hasFeedbackSystem", "targetMinors"];
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
  fn.textContent = (filter !== "all" ? labels[filter] + "（筛选中，说明性内容始终保留）" : "");
  fn.classList.toggle("hidden", filter === "all" && !query);
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
  document.getElementById("cnt").textContent =
    done + " / " + total + " 项已完成" + (skip ? " · 跳过 " + skip : "");
  document.getElementById("fill").style.width = pct + "%";

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
  const target = [...document.querySelectorAll("li.item")].find(l => {
    const s = st(l.dataset.id);
    return s !== "done" && s !== "skip" && l.dataset.locked === "0";
  });
  if(!target) return;
  // 若在筛选/搜索状态下，先切回「全部」并清空搜索
  if(filter !== "all" || query){
    filter = "all"; query = "";
    document.getElementById("q").value = "";
    document.querySelectorAll("#seg button").forEach(b => b.classList.toggle("on", b.dataset.f === "all"));
    applyFilter();
  }
  target.scrollIntoView({block:"center", behavior:"smooth"});
  target.animate(
    [{background:"#DCEAF9"},{background:"transparent"}],
    {duration:1200, easing:"ease-out"}
  );
}
function refreshAll(){
  updateSaveStatus();
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
let saveQueue=Promise.resolve(), queuedWrites=0;
function api(path,body){
 const writing=body!==undefined&&!['/api/backups','/api/perm-config','/api/perm-en-preview','/api/perm-write-en'].includes(path);
 if(!writing)return apiRequest(path,body);
 queuedWrites++;updateSaveStatus();
 const observedRevision=baseRevision;
 const result=saveQueue.catch(()=>{}).then(()=>apiRequest(path,{...body,revision:body.revision===undefined||body.revision===observedRevision?baseRevision:body.revision}));
 saveQueue=result.finally(()=>{queuedWrites--;setTimeout(updateSaveStatus,0);});saveQueue.catch(()=>{});return result;
}
async function apiRequest(path, body){
  const writing = body !== undefined && !["/api/profiles", "/api/backups", "/api/perm-config", "/api/perm-en-preview", "/api/perm-write-en"].includes(path);
  if(writing){ savingOperations++; saveFailure=""; updateSaveStatus(); }
  try{
  const opt = body === undefined ? {} : {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(Object.assign({revision:baseRevision}, body))
  };
  const r = await boardFetch(path, opt);
  if(!r.ok){ const err = await r.json().catch(() => ({})); throw new Error(err.error || (path + " -> HTTP " + r.status)); }
  const data = await r.json();
  if(body !== undefined && data.revision){ baseRevision = data.revision; saveState(); }
  if(writing) lastSavedAt = Date.now();
  return data;
  }catch(error){ if(writing) saveFailure=error.message; throw error; }
  finally{ if(writing) savingOperations--; setTimeout(updateSaveStatus,0); }
}
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
    setMode(true);
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
document.getElementById("list").addEventListener("change", e => {
  const cb = e.target;
  if(cb.type !== "checkbox") return;
  const li = cb.closest("li.item");
  const id = li.dataset.id;
  if(li.dataset.locked === "1"){
    cb.checked = false;
    toast("必须按顺序完成前面的条目");
    return;
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
  document.querySelectorAll("#seg button").forEach(b => b.classList.toggle("on", b === btn));
  applyFilter();
});
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
  if((dirty || featureHasChanges() || permDirty || savingOperations>0) && online){ e.preventDefault(); e.returnValue = ""; }
});

/* ------------------------------------------------------------------ *
 * 权限与隐私配置面板
 * ------------------------------------------------------------------ */
let PROFILES = null;         // 权限元数据
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
      el.addEventListener("click", () => {
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
  renderDescs();
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
}
function closePermPanel(){
  document.getElementById("permPanel").classList.remove("on");
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

/* --------------------------------------------------------------
 * 项目设置：账号系统 / 未成年用户
 * 切换后立即重算可见条目并重新连续编号；保存时写回 md 的 FEATURES 行。
 * -------------------------------------------------------------- */
const featFeedback = document.getElementById("featFeedback");
const featAcc = document.getElementById("featAcc");
const featMinor = document.getElementById("featMinor");

function currentFeatures(){
  return {
    hasAccountSystem: !!(DATA && DATA.features && DATA.features.hasAccountSystem),
    hasFeedbackSystem: !!(DATA && DATA.features && DATA.features.hasFeedbackSystem),
    targetMinors: !!(DATA && DATA.features && DATA.features.targetMinors)
  };
}
function refreshFeatUI(){
  const f = currentFeatures();
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
    if(hidden.length === 0){
      pv.innerHTML = "<b>项目功能开关没有隐藏检查项。</b><br>权限相关条目仍按「权限配置」面板的选择显示。";
    }else{
      const byCond = {};
      hidden.forEach(it => { (byCond[it.cond] = byCond[it.cond] || []).push(it.text); });
      const LABEL = {
        hasAccountSystem: "无用户账号系统",
        hasFeedbackSystem: "无用户反馈系统",
        targetMinors: "不面向未成年用户"
      };
      let html = "<b>以下 " + hidden.length + " 项因项目功能设置隐藏：</b>";
      Object.keys(byCond).forEach(c => {
        html += "<span class=\"fx\"><b>" + (LABEL[c] || c) + "</b> — " + byCond[c].length + " 项<br>"
              + byCond[c].map(x => "· " + escapeHtml(x.replace(/<[^>]+>/g, "").replace(/\*\*/g, ""))).join("<br>") + "</span>";
      });
      pv.innerHTML = html;
    }
  }
}
let featureSnapshot = null;
function openFeatPanel(){
  featureSnapshot = JSON.parse(JSON.stringify(DATA.features));
  refreshFeatUI();
  document.getElementById("featPanel").classList.add("on");
}
function closeFeatPanel(){
  if(featureSnapshot){ DATA.features=featureSnapshot; featureSnapshot=null; render(); refreshFeatUI(); updateSaveStatus(); }
  document.getElementById("featPanel").classList.remove("on");
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
    hasFeedbackSystem: featFeedback.checked,
    hasAccountSystem: featAcc.checked,
    targetMinors: featMinor.checked
  };
  applyFeatures();
  render();
  refreshFeatUI();
  updateSaveStatus();
}
featFeedback.addEventListener("change", onFeatToggle);
featAcc.addEventListener("change", onFeatToggle);
featMinor.addEventListener("change", onFeatToggle);

// 保存到 md
document.getElementById("featSave").addEventListener("click", async () => {
  const f = {hasAccountSystem: featAcc.checked, targetMinors: featMinor.checked, hasFeedbackSystem: featFeedback.checked};
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

/* ---- 使用说明入口 ---- */
function openGuide(){
  // 服务端模式走 /guide（内容总是最新的），离线模式走同目录 html
  window.open(online ? (window.RELEASE_CLOUD ? "/projects/" + window.RELEASE_CLOUD.projectId + "/guide" : "/guide") : "使用说明.html", "_blank");
}
document.getElementById("btnGuide").addEventListener("click", openGuide);
document.getElementById("btnGuide2").addEventListener("click", openGuide);

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


async function persistReview(next){
  try{
    const d = await api("/api/review", {revision:baseRevision, review:next});
    baseRevision = d.revision;
    reviewData = d.review;
    build(); refreshAll(); saveState();
    toast("检查记录已保存");
    return true;
  }catch(e){ toast("保存失败：" + e.message); return false; }
}
document.getElementById("releaseEdit").onclick = async () => {
  if(!online){ toast("请先连接本地服务"); return; }
  const next = JSON.parse(JSON.stringify(reviewData));
  next.release = next.release || {};
  for(const [key,label] of [["app","App 名称"],["platform","平台"],["version","版本号"],["build","构建号"],["date","检查日期"],["owner","负责人"]]){
    const value = prompt(label, next.release[key] || (key === "date" ? new Date().toLocaleDateString("sv-SE") : ""));
    if(value === null) return;
    next.release[key] = value;
  }
  await persistReview(next);
};
function releaseSnapshot(){
  return {release:reviewData.release || {}, date:new Date().toISOString(), features:{...DATA.features}, selectedPermissions:[...(DATA.permSelected||[])], items:DATA.sections.flatMap(s => s.blocks).filter(b => b.type === "item" && !b.gate).map(b => ({id:b.id,text:b.text,state:st(b.id), applicable:b.visible !== false, ...(reviewData.items || {})[b.id]}))};
}
document.getElementById("releaseArchive").onclick = async () => {
  if(!online || dirty){ toast("请先连接服务并保存勾选进度"); return; }
  if(!confirm("归档当前发布信息和检查结果？")) return;
  const next = JSON.parse(JSON.stringify(reviewData));
  next.history = next.history || [];
  next.history.push(releaseSnapshot());
  await persistReview(next);
};
document.getElementById("releaseSummary").onclick = () => {
  const snapshot = releaseSnapshot();
  const lines = ["# 发布检查摘要", "", ...Object.entries(snapshot.release).map(([k,v]) => k + ": " + v), "", "生成时间：" + new Date().toLocaleString(), dirty ? "包含尚未写回的进度" : "", ""];
  for(const item of snapshot.items){
    lines.push("- [" + ({done:"x",skip:"-",todo:" "}[item.state]) + "] " + item.text + (item.applicable ? "" : "（不适用）"));
    for(const key of ["reason","notes","evidence"]) if(item[key]) lines.push("  " + key + ": " + item[key]);
  }
  lines.push("", "## 历史发布记录", "```json", JSON.stringify(reviewData.history || [], null, 2), "```");
  const url = URL.createObjectURL(new Blob([lines.join("\n")], {type:"text/markdown;charset=utf-8"}));
  const a = document.createElement("a"); a.href=url; a.download="发布检查摘要.md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.getElementById("backupRestore").onclick = async () => {
  if(!online){ toast("请先连接本地服务"); return; }
  try{
    const d = await api("/api/backups", {});
    if(!d.backups.length){ toast("暂无备份"); return; }
    const choice = prompt("输入要恢复的备份序号：\n" + d.backups.map((n,i) => (i+1) + ". " + (d.entries ? new Date(d.entries[i].created_at * 1000).toLocaleString() + " · " + d.entries[i].label : n)).join("\n"));
    if(choice === null) return;
    const name = d.backups[Number(choice)-1];
    if(!name){ toast("序号无效"); return; }
    if(!confirm("将恢复 Markdown 清单，当前文件会先备份。权限面板和发布记录保留当前值。未保存勾选将丢弃，是否继续？")) return;
    const result = await api("/api/restore", {name, revision:baseRevision});
    localStorage.removeItem(LS_KEY);
    dirty = false;
    location.reload();
  }catch(e){ toast("恢复失败：" + e.message); }
};

document.getElementById("mobileSave").onclick=()=>document.getElementById("btnSave").click();
document.getElementById("mobileCurrent").onclick=jumpToCurrent;
document.getElementById("mobileExport").onclick=()=>document.getElementById("releaseSummary").click();
document.getElementById("featPanel").addEventListener('click',e=>{if(e.target.id==='featPanel')closeFeatPanel();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('featPanel').classList.contains('on'))closeFeatPanel();});

const newReleaseButton=document.getElementById('newRelease');
newReleaseButton.hidden=!(window.RELEASE_PAGES||window.RELEASE_CLOUD);
newReleaseButton.onclick=()=>{
 if(dirty||permDirty||featureHasChanges()||savingOperations){toast('请先保存所有改动，再开始新一轮发布');return;}
 document.getElementById('newReleaseForm').reset();document.getElementById('newReleaseError').textContent='';document.getElementById('newReleaseDialog').showModal();
};
document.getElementById('cancelNewRelease').onclick=()=>document.getElementById('newReleaseDialog').close();
document.getElementById('newReleaseForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
 try{
  const release={...reviewData.release,version:form.elements.version.value.trim(),build:form.elements.build.value.trim(),date:new Date().toLocaleDateString('sv-SE')};
  const d=await api('/api/new-release',{release,keepNotes:form.elements.keepNotes.checked,keepEvidence:form.elements.keepEvidence.checked});
  gen=d.generation;reviewData=d.review;state=seedFromData(d);serverBaseline=baselineFromData(d);DATA=mergeItems(d);dirty=false;saveState();render();refreshFeatUI();document.getElementById('newReleaseDialog').close();toast('上一轮已归档，新一轮发布已开始');
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
