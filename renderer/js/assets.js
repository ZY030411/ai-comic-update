// ============================================================
// Tab 3：资产拆分与校验（全局合并视图 / 按集查看 / 停止 / 搜索）
// ============================================================

import {
  state,
  getEpisodes,
  saveDraft,
  uid,
  activeEpisodeNo,
  ASSET_CATS,
  assetsOf,
  assetsForEpisode,
  findAssetById,
  mergeAsset,
  isEnvObject,
  dedupeKey,
  scriptFullText,
  baseName,
  countOccurrences,
  resetAssetState,
} from "./state.js";
import { $, $$, toast, busy, esc, fieldModal, confirmModal, setProgress } from "./ui.js";
import { aiCall, extractJson, cancelLLM } from "./api.js";
import { setActiveEpisode, switchTab, updateNav } from "./app.js";
import { stylePrefix } from "./style.js";
import { petWorking, petDone, petSay } from "./pet.js";

let stopRequested = false;
let assetSearchText = "";
let splitUi = "idle"; // idle | running | stopped
let assetScope = "all"; // all | ep
let scopeEp = 1;
let assetCat = "single";
const CONCURRENCY = 2;

export function initAssets() {
  // 资产拆分规则配置
  $("#splitRuleHead").addEventListener("click", () => {
    const closed = $("#splitRuleBody").classList.toggle("closed");
    $("#splitRuleArrow").textContent = closed ? "▸" : "▾";
  });
  $("#splitRuleText").addEventListener("change", () => {
    state.settings.splitPrompt = $("#splitRuleText").value;
    saveDraft();
    toast("已保存资产拆分规则");
  });
  $("#btnLoadSplitRule").addEventListener("click", () => loadSplitRule("sample"));
  $("#btnResetSplitRule").addEventListener("click", () => loadSplitRule("default"));
  $("#btnImportSplitRule").addEventListener("click", importSplitRule);
  $("#btnSaveSplitRule").addEventListener("click", () => {
    state.settings.splitPrompt = $("#splitRuleText").value;
    saveDraft();
    toast("已保存资产拆分规则");
  });
  $("#splitRuleText").value = state.settings.splitPrompt || "";

  $("#btnSplitAll").addEventListener("click", () => splitAll());
  $("#btnStopSplit").addEventListener("click", () => requestStop());
  $("#btnResplit").addEventListener("click", () => resplitAssets());
  $("#btnCompleteAll").addEventListener("click", () => completeAll());
  $("#btnAnnotate").addEventListener("click", () => annotateSingles());
  $("#assetSearch").addEventListener("input", (e) => {
    assetSearchText = e.target.value.trim().toLowerCase();
    renderAllAssets();
  });
  $$("#assetScopeChips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      assetScope = chip.dataset.scope;
      $$("#assetScopeChips .chip").forEach((c) => c.classList.toggle("active", c === chip));
      $("#assetScopeWrap").hidden = assetScope !== "ep";
      if (assetScope === "ep") {
        scopeEp = activeEpisodeNo();
        renderScopeEpSelect();
      }
      renderAllAssets();
    });
  });
  $("#assetScopeEpSel").addEventListener("change", (e) => {
    scopeEp = Number(e.target.value);
    setActiveEpisode(scopeEp);
    renderScopeEpSelect();
    renderAllAssets();
  });

  $$("#assetCatTabs .atab").forEach((tab) => {
    tab.addEventListener("click", () => {
      assetCat = tab.dataset.cat;
      $$("#assetCatTabs .atab").forEach((t) => t.classList.toggle("active", t === tab));
      $("#addAssetBtn").dataset.cat = assetCat;
      renderAllAssets();
    });
  });

  $("#assetEpToggle").addEventListener("click", () => {
    const strip = $("#assetEpisodes");
    const open = strip.hidden;
    strip.hidden = !open;
    $("#assetEpToggle").textContent = open ? "📂 全部集数（收起）" : "📂 全部集数（展开）";
  });

  $("#addAssetBtn").addEventListener("click", () => addAssetModal(assetCat));

  $$(".asset-list").forEach((list) => {
    list.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const cat = list.dataset.cat;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const item = findAssetById(cat, id);
      if (!item) return;
      if (act === "verify") {
        item.verified = !item.verified;
        saveDraft();
        renderAllAssets();
        updateSplitProgress();
        toast(item.verified ? `「${item.name}」已校验通过` : `「${item.name}」已取消校验`);
      } else if (act === "edit") {
        editAssetModal(cat, id);
      } else if (act === "del") {
        confirmModal("删除资产", `确定删除「${item.name}」吗？`, () => {
          const list2 = assetsOf(cat);
          const idx = list2.findIndex((x) => x.id === id);
          if (idx >= 0) list2.splice(idx, 1);
          saveDraft();
          renderAllAssets();
          updateSplitProgress();
          toast("已删除资产");
        });
      } else if (act === "gen") {
        generatePromptForItem(cat, item).catch(() => {});
      }
    });
  });
}

async function loadSplitRule(kind) {
  const res = await window.api.readSample("资产拆分提示词配置要求.txt");
  if (!res.ok) {
    toast("内置拆分规则读取失败", "err");
    return;
  }
  state.settings.splitPrompt = res.text;
  saveDraft();
  $("#splitRuleText").value = res.text;
  toast(kind === "default" ? "已恢复默认拆分规则" : "已载入内置拆分规则");
}

async function importSplitRule() {
  const p = await window.api.openFile([{ name: "规则文件", extensions: ["txt", "md", "docx"] }, { name: "所有文件", extensions: ["*"] }]);
  if (!p) return;
  const res = await window.api.readText(p);
  if (!res.ok) {
    toast("读取失败：" + res.error, "err");
    return;
  }
  state.settings.splitPrompt = res.text;
  saveDraft();
  $("#splitRuleText").value = res.text;
  toast("已导入资产拆分规则：" + res.name);
}

function renderAssetScriptBlock() {
  const block = $("#assetScriptBlock");
  const epNo = assetScope === "ep" ? scopeEp : activeEpisodeNo();
  const ep = getEpisodes().find((e) => Number(e.no) === Number(epNo));
  if (assetScope === "ep" && ep) {
    block.hidden = false;
    $("#assetScriptEp").textContent = ep.no;
    $("#assetScriptText").value = ep.raw || "";
  } else {
    block.hidden = true;
    $("#assetScriptText").value = "";
  }
}

export function requestStop() {
  stopRequested = true;
  splitUi = "stopped";
  cancelLLM();
  const bar = $("#splitBar"), num = $("#splitPercent"), det = $("#splitDetail");
  if (bar) bar.style.width = "0%";
  if (num) num.textContent = "0%";
  if (det) det.textContent = "已停止拆分，进度已重置。";
  toast("已停止拆分并重置进度", "err");
}

// ---------- 拆分 ----------

function splitSystemPrompt() {
  const base = state.settings.splitPrompt || "你是专业影视/短剧/三维动画前期资产拆分设计师。";
  const style = stylePrefix();
  return `${base}

【附加要求】
1. 只输出严格 JSON，不要输出任何解释或 Markdown 代码块以外的内容。
2. 输出结构如下：
{"single":[{"name":"角色名","level":"核心主角|次要配角|路人NPC-单人|路人NPC-群像","description":"人物描述","osummary":"实体出镜集数与OS/VO集数" }],
 "group":[{"name":"群像名","description":"群像描述"}],
 "scene":[{"name":"场景名","description":"场景描述","states":"该场景包含的时段/光影/视角与全部出场集数"}],
 "prop":[{"name":"道具名","description":"道具描述","states":"出镜状态备注"}]}
3. 【场景】同一物理地点仅昼夜/视角/光影/氛围变化：**合并为一条场景**，在 states 里写明包含的时段、视角与全部出场集数，**严禁拆成“*‑夜晚”“*‑白天”等多张**；仅当空间发生本质改造/损毁才新建一条。
4. 【人物】只生成剧本实际出镜的实体人物；OS 内心独白、VO 画外音**不单独建卡**，归属其本体人物并写进 osummary。人物按 核心主角 / 次要配角 / 路人NPC-单人 / 路人NPC-群像 分级；**带代号的个体（路人A、群众A 等）是路人NPC-单人，归入 single，不属群像**；仅无名大批人群才归 group。
5. 【道具】同一道具仅状态变化（破损/完好/新旧）合并一条并备注 states；仅物理替换才新建。
6. 人物、场景、道具三大板块描述完全隔离。
7. **不要拆分自然环境物**：水、草丛、草地、石头、石子、树、树木、树枝、泥土、灰尘、火焰、烟雾、雾气、光、风、雨、雪、云、天空、地面、墙壁、河水、海水、月光、阳光、空气、落叶、灌木、露水、石阶等，严禁放进 prop。
8. 动作只保留剧本明确写出的动作，不得脑补。
${style ? `9. 本剧视觉类型：${style}。` : ""}`;
}

async function splitEpisode(no) {
  const ep = getEpisodes().find((e) => Number(e.no) === no);
  if (!ep) return null;
  const user = `以下是完整剧本片段（第 ${no} 集）：\n\n${ep.raw || ep.title || "(空)"}\n\n请按规则完成全套资产拆分，并输出严格 JSON。`;
  const text = await aiCall({ system: splitSystemPrompt(), user });
  const json = extractJson(text);
  if (!json) throw new Error(`第 ${no} 集输出无法解析为 JSON，请检查模型输出或重试`);

  let single = Array.isArray(json.single) ? json.single : [];
  let group = Array.isArray(json.group) ? json.group : [];
  if (Array.isArray(json.characters)) {
    for (const c of json.characters) {
      const isGroup =
        /群像|路人|NPC|群众|多人|众人|百姓/.test(c.level || "") ||
        /群像|群众|百姓|人们|众人/.test(c.name || "");
      (isGroup ? group : single).push(c);
    }
  }
  for (const it of single) if (it && it.name) mergeAsset("single", { ...it, level: normLevel(it.level) }, no);
  for (const it of group) {
    if (!it || !it.name) continue;
    if (isCrowdName(it.name)) mergeAsset("group", it, no);
    else mergeAsset("single", { ...it, level: normLevel(it.level) }, no);
  }
  for (const it of json.scene || []) if (it && it.name) mergeAsset("scene", it, no);
  for (const it of json.prop || []) if (it && it.name && !isEnvObject(it.name)) mergeAsset("prop", it, no);
  // 依据场次标题（如 1-1日 外 镇北王府）补充场景，避免场景名碎化
  for (const sc of ep.scenes || []) {
    const loc = headerLocation(sc.header);
    if (loc) mergeAsset("scene", { name: loc }, no);
  }
  saveDraft();
  return true;
}

function headerLocation(header) {
  let s = String(header || "").trim();
  s = s.replace(/^\s*\d+\s*[-－—]\s*\d+\s*/, "");
  s = s.replace(/^(日|夜|晨|黄昏|傍晚|清晨|白天|晚上|早上|深夜|正午|夜景|日间)\s*/, "");
  s = s.replace(/^(内|外|户外|室内|室外|在内|在外)\s*/, "");
  return s.trim();
}

// 判断角色是否真正“出场”（出现在场景/动作/字幕/对白声轨），而非仅被他人提及
function isCharOnScreen(name) {
  const lines = scriptFullText().split("\n");
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let inSpeech = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const speakerRe = new RegExp(`^${escName}[^：:]{0,14}[：:]`);
    const anySpeakerRe = /^[^：:]{1,16}[：:]/;
    if (!inSpeech) {
      if (line.includes(name) && (/^\s*△/.test(line) || /字幕|旁白|画外音|VO|OS|内心/.test(line) || /^\d+\s*[-－—]\s*\d+/.test(trimmed))) return true;
      if (speakerRe.test(line)) return true;
      if (line.includes(name) && !anySpeakerRe.test(line)) return true;
    } else {
      if (speakerRe.test(line)) return true;
      if (anySpeakerRe.test(line)) { inSpeech = true; continue; }
      if (/^\s*△/.test(line) || /^\d+\s*[-－—]\s*\d+/.test(trimmed)) { inSpeech = false; if (line.includes(name)) return true; }
    }
    if (!inSpeech && anySpeakerRe.test(line) && /[：:]/.test(line)) inSpeech = true;
  }
  return false;
}

export function pruneMentionOnly() {
  for (const cat of ["single", "group"]) {
    const list = state.assets[cat] || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      const base = baseName(a.name);
      if (!isCharOnScreen(base) && !isCharOnScreen(a.name)) {
        list.splice(i, 1);
      }
    }
  }
  saveDraft();
}

function normLevel(v) {
  const s = String(v || "");
  if (/配角/.test(s)) return "次要配角";
  if (/路人|NPC|群像|群众/.test(s)) return "路人NPC/群像";
  return "核心主角";
}

// 真正的人群/群像才进 group，其余（含“男观众A”“女人1”等带编号个体）进 single
function isCrowdName(name) {
  const s = String(name || "");
  if (/们$/.test(s)) return true;
  if (/群像|人群|群众|众人|大家|百姓|所有人|诸位|各位|一群|多名|多位|几名|几位|听众|群臣|人潮|人海|围观/.test(s)) return true;
  return false;
}

function resplitAssets() {
  confirmModal("重新拆分资产", "将清空当前全部资产与提示词，并按当前规则重新拆分所有集数。确定继续吗？", () => {
    resetAssetState();
    splitAll(true);
  });
}

export async function splitAll(force = false) {
  const eps = getEpisodes();
  if (!eps.length) {
    toast("请先在上传剧本中载入剧本", "err");
    switchTab("upload");
    return;
  }
  if (!state.settings.apiKey) {
    toast("请先在右侧「AI 模型设置」中配置 API Key", "err");
    return;
  }
  stopRequested = false;
  splitUi = "running";
  if (force) resetAssetState();
  const btn = $("#btnSplitAll");
  const det = $("#splitDetail");
  busy(btn, true);
  det.classList.add("busy");
  petWorking();
  // 断点续跑（默认只拆未完成集数）；强制重拆时拆分全部
  const targets = force ? eps : eps.filter((e) => ASSET_CATS.every((c) => !assetsForEpisode(c.key, e.no).length));
  if (!targets.length) {
    busy(btn, false);
    det.classList.remove("busy");
    petSay("所有集数都已拆分完成啦～");
    toast("所有集数均已有资产，无需重复拆分");
    return;
  }
  const total = targets.length;
  let ok = 0, fail = 0;
  let cursor = 0;
  let processed = 0;
  async function worker() {
    while (cursor < total) {
      if (stopRequested) break;
      const ep = targets[cursor++];
      det.textContent = `正在拆分第 ${ep.no} 集（已完成 ${processed}/${total}）…`;
      setProgress($("#splitBar"), $("#splitPercent"), (processed / total) * 100);
      try {
        await splitEpisode(ep.no);
        ok++;
      } catch (err) {
        if (stopRequested) break;
        fail++;
        toast(`第 ${ep.no} 集拆分失败：${err.message}`, "err");
      }
      processed++;
    }
  }
  try {
    const workers = Math.min(CONCURRENCY, total) || 1;
    await Promise.all(Array.from({ length: workers }, () => worker()));
  } finally {
    busy(btn, false);
    det.classList.remove("busy");
    if (!stopRequested) splitUi = "done";
    stopRequested = false;
  }
  renderAllAssets();
  renderAssetEpisodes();
  updateSplitProgress();
  updateNav();
  pruneMentionOnly();
  annotateSingles();
  renderAllAssets();
  if (fail > 0) petDone(`拆分结束：成功 ${ok} 集，失败 ${fail} 集`);
  else petDone(`资产拆分完成！共拆分 ${ok} 集`);
}

export async function completeAll() {
  const eps = getEpisodes();
  if (!eps.length) {
    toast("请先载入剧本", "err");
    return;
  }
  const missing = eps.filter((e) => ASSET_CATS.every((c) => !assetsForEpisode(c.key, e.no).length));
  if (!missing.length) {
    petSay("所有集数都齐啦～");
    toast("所有集数均已有资产，无需补全");
    return;
  }
  stopRequested = false;
  splitUi = "running";
  const btn = $("#btnCompleteAll");
  const det = $("#splitDetail");
  busy(btn, true);
  det.classList.add("busy");
  petWorking();
  let count = 0;
  try {
    for (let i = 0; i < missing.length; i++) {
      if (stopRequested) break;
      det.textContent = `一键补全：正在拆分第 ${missing[i].no} 集（${i + 1}/${missing.length}）…`;
      try {
        await splitEpisode(missing[i].no);
        count++;
      } catch (err) {
        if (stopRequested) break;
        toast(`第 ${missing[i].no} 集补全失败：${err.message}`, "err");
      }
    }
  } finally {
    busy(btn, false);
    det.classList.remove("busy");
    if (!stopRequested) splitUi = "done";
    stopRequested = false;
  }
  renderAllAssets();
  renderAssetEpisodes();
  updateSplitProgress();
  updateNav();
  pruneMentionOnly();
  annotateSingles();
  renderAllAssets();
  petDone(`一键补全完成，共处理 ${count} 集`);
}

// 标注单人主要角色：按出场次数取前 8，从高到低排序
const ROLE_HINTS = ["男主", "女主", "男一", "女一", "男二", "女二", "主角", "反派", "堂姐", "表哥", "世子", "王爷", "太子", "公主", "将军", "大哥", "弟弟", "小姐", "娘娘", "皇上", "贵妃"];

function detectRole(text, base) {
  const idx = text.indexOf(base);
  if (idx < 0) return "";
  const win = text.slice(Math.max(0, idx - 34), idx + base.length + 34);
  for (const k of ROLE_HINTS) if (win.includes(k)) return k;
  return "";
}

export function annotateSingles() {
  const eps = getEpisodes();
  if (!eps.length) {
    toast("请先载入剧本", "err");
    return;
  }
  const text = scriptFullText();
  const singles = state.assets.single || [];
  for (const a of singles) {
    const base = baseName(a.name);
    let count = countOccurrences(text, base);
    if (a.name !== base) count += countOccurrences(text, a.name);
    a.appearances = Math.max(count, 1);
    a.majorRole = false;
    a.role = detectRole(text, base);
  }
  // 出场次数从高到低
  singles.sort((x, y) => (y.appearances || 0) - (x.appearances || 0));
  // 前 8 名标记为主要角色
  singles.slice(0, 8).forEach((a) => {
    if ((a.appearances || 0) > 1) {
      a.majorRole = true;
      if (!a.role) a.role = "主要角色";
    }
  });
  saveDraft();
  renderAllAssets();
  updateSplitProgress();
  toast(`已按出场次数标注主要角色（前 ${Math.min(8, singles.length)} 名）`);
}

// ---------- 渲染 ----------

function renderScopeEpSelect() {
  const sel = $("#assetScopeEpSel");
  const eps = getEpisodes();
  sel.innerHTML = "";
  if (!eps.length) {
    const opt = document.createElement("option");
    opt.value = "1";
    opt.textContent = "暂无集数";
    sel.appendChild(opt);
    return;
  }
  for (const ep of eps) {
    const opt = document.createElement("option");
    opt.value = ep.no;
    opt.textContent = `第 ${ep.no} 集`;
    if (Number(ep.no) === scopeEp) opt.selected = true;
    sel.appendChild(opt);
  }
}

export function renderAssetEpisodes() {
  const wrap = $("#assetEpisodes");
  const eps = getEpisodes();
  wrap.innerHTML = "";
  if (!eps.length) {
    const tip = document.createElement("span");
    tip.className = "badge gray";
    tip.textContent = "请先上传剧本";
    wrap.appendChild(tip);
    return;
  }
  const active = activeEpisodeNo();
  for (const ep of eps) {
    const has = ASSET_CATS.some((c) => assetsForEpisode(c.key, ep.no).length);
    const allVerified =
      has &&
      ASSET_CATS.every((c) => {
        const l = assetsForEpisode(c.key, ep.no);
        return l.length && l.every((x) => x.verified);
      });
    const btn = document.createElement("button");
    btn.className = "ep-chip" + (Number(ep.no) === active ? " active" : "") + (has ? (allVerified ? " done" : " gen") : "");
    btn.textContent = `第${ep.no}集`;
    btn.title = has ? (allVerified ? "已拆分并校验完成" : "已拆分，待校验") : "未拆分";
    btn.addEventListener("click", () => {
      setActiveEpisode(ep.no);
      scopeEp = ep.no;
      renderScopeEpSelect();
      renderAssetEpisodes();
      renderAllAssets();
      updateSplitProgress();
    });
    wrap.appendChild(btn);
  }
}

export function renderAllAssets() {
  const cat = ASSET_CATS.find((c) => c.key === assetCat) || ASSET_CATS[0];
  const list = assetScope === "all" ? assetsOf(cat.key) : assetsForEpisode(cat.key, scopeEp);
  renderAssetList(cat, list);
  updateAssetCounts();
  renderAssetScriptBlock();
}

function matchSearch(item) {
  if (!assetSearchText) return true;
  return item.name.toLowerCase().includes(assetSearchText) || item.desc.toLowerCase().includes(assetSearchText);
}

function renderAssetList(cat, items) {
  const wrap = $("#list-asset");
  wrap.dataset.cat = cat.key;
  wrap.innerHTML = "";
  let filtered = items.filter(matchSearch);
  if (cat.key === "single") filtered = filtered.slice().sort((a, b) => (b.appearances || 0) - (a.appearances || 0));
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-tip";
    empty.innerHTML = assetSearchText ? "没有匹配的资产" : `暂无${cat.label}资产<br/>可点击下方按钮手动添加，或运行 AI 拆分`;
    wrap.appendChild(empty);
    return;
  }
  for (const item of filtered) {
    const el = document.createElement("div");
    el.className = "asset-item" + (item.verified ? " verified" : "");
    const eps = (item.episodes || []).slice().sort((a, b) => a - b);
    const epsText = eps.length > 6 ? `第${eps.slice(0, 6).join("、")}…等${eps.length}集` : `第${eps.join("、")}集`;
    const levelTag = item.level ? `<span class="badge gray">${esc(item.level)}</span>` : "";
    const tone = cat.key === "scene" ? "blue" : cat.key === "prop" ? "amber" : "purple";
    const majorTags =
      cat.key === "single" && item.majorRole
        ? `<div class="asset-major-tags"><span class="badge pink">★ 主要角色</span><span class="badge amber">出场 ${item.appearances || 1} 次</span>${item.role && item.role !== "主要角色" ? `<span class="badge blue">${esc(item.role)}</span>` : ""}</div>`
        : "";
    const costumeLine =
      item.costumes && Object.keys(item.costumes).length
        ? `<div class="asset-costumes">👕 服饰：${Object.entries(item.costumes).sort((a, b) => Number(a[0]) - Number(b[0])).map(([ep, c]) => `第${ep}集 ${esc(c)}`).join(" · ")}</div>`
        : "";
    const sceneTimeLine =
      cat.key === "scene" && item.times && Object.keys(item.times).length
        ? `<div class="asset-costumes">⏰ 时段：${Object.entries(item.times).sort((a, b) => Number(a[0]) - Number(b[0])).map(([ep, t]) => `第${ep}集 ${esc(t)}`).join(" · ")}</div>`
        : "";
    el.innerHTML = `
      <div class="asset-item-head">
        <span class="asset-name">${esc(item.name)}</span>
        <span class="badge ${tone} asset-level">${esc(cat.label)}</span>
        ${levelTag}
      </div>
      ${majorTags}
      <div class="asset-episodes">📌 出现于 ${esc(epsText)}</div>
      ${costumeLine}
      ${sceneTimeLine}
      <div class="asset-desc">${esc(item.desc || "（无描述）")}</div>
      <div class="asset-item-actions">
        <button class="mini-btn ok" data-act="verify" data-id="${item.id}">${item.verified ? "✓ 已校验" : "○ 校验"}</button>
        <button class="mini-btn" data-act="edit" data-id="${item.id}">编辑</button>
        <button class="mini-btn" data-act="gen" data-id="${item.id}">生成提示词</button>
        <button class="mini-btn" data-act="del" data-id="${item.id}">删除</button>
      </div>`;
    wrap.appendChild(el);
  }
}

function updateAssetCounts() {
  const counts = {};
  for (const cat of ASSET_CATS) {
    const list = assetScope === "all" ? assetsOf(cat.key) : assetsForEpisode(cat.key, scopeEp);
    counts[cat.key] = list.length;
    const badge = $(`#count-${cat.key}`);
    if (badge) badge.textContent = `${list.length} 项`;
  }
  const sum = ASSET_CATS.reduce((s, c) => s + counts[c.key], 0);
  $("#assetCounts").innerHTML = ASSET_CATS.map((c) => `<span class="badge">${c.icon} ${c.label} ${counts[c.key]}</span>`).join("") + `<span class="badge gray">合计 ${sum}</span>`;
}

export function updateSplitProgress() {
  const eps = getEpisodes();
  const bar = $("#splitBar"), num = $("#splitPercent"), det = $("#splitDetail");
  if (!eps.length) {
    if (bar) bar.style.width = "0%";
    if (num) num.textContent = "0%";
    if (det) det.textContent = "尚未拆分。请先在「上传剧本」中载入剧本。";
    return;
  }
  if (splitUi === "stopped") {
    if (bar) bar.style.width = "0%";
    if (num) num.textContent = "0%";
    if (det) det.textContent = "已停止拆分，进度已重置，可重新开始。";
    return;
  }
  // 一次拆分任务完整跑完 = 100%（避免个别集数资产被过滤后进度卡在 97%）
  if (splitUi === "done") {
    if (bar) bar.style.width = "100%";
    if (num) num.textContent = "100%";
    if (det) det.textContent = `已拆分全部集数 · 资产 ${AssetTotal()} 项 · 已校验 ${VerifiedCount()} 项`;
    return;
  }
  let total = 0, verified = 0, withAssets = 0;
  for (const ep of eps) {
    let epCount = 0;
    for (const cat of ASSET_CATS) {
      for (const item of assetsForEpisode(cat.key, ep.no)) {
        total++;
        epCount++;
        if (item.verified) verified++;
      }
    }
    if (epCount > 0) withAssets++;
  }
  if (total === 0) {
    if (bar) bar.style.width = "0%";
    if (num) num.textContent = "0%";
    if (det) det.textContent = `共 ${eps.length} 集，尚未拆分任何资产。`;
    return;
  }
  const splitPct = Math.min(100, (withAssets / eps.length) * 100);
  if (bar) bar.style.width = splitPct + "%";
  if (num) num.textContent = Math.round(splitPct) + "%";
  if (det) det.textContent = `已拆分 ${withAssets}/${eps.length} 集 · 资产 ${total} 项 · 已校验 ${verified} 项（全局已合并同名）`;
}

function AssetTotal() {
  let total = 0;
  for (const ep of getEpisodes()) {
    for (const cat of ASSET_CATS) total += assetsForEpisode(cat.key, ep.no).length;
  }
  return total;
}

function VerifiedCount() {
  let v = 0;
  for (const ep of getEpisodes()) {
    for (const cat of ASSET_CATS) for (const it of assetsForEpisode(cat.key, ep.no)) if (it.verified) v++;
  }
  return v;
}

// ---------- 添加 / 编辑 ----------

function addAssetModal(cat) {
  const def = ASSET_CATS.find((c) => c.key === cat);
  const pieces = assetScope === "ep" ? `加入第 ${scopeEp} 集` : "加入全局资产";
  fieldModal({
    title: `添加缺失${def.label}（${pieces}）`,
    fields: [
      { key: "name", label: "名称", placeholder: `例如：${cat === "single" ? "林默" : cat === "group" ? "群众" : cat === "scene" ? "出租屋内" : "猫粮碗"}` },
      { key: "level", label: "分级", type: "select", options: cat === "single" ? ["核心主角", "次要配角"].map((l) => ({ value: l, label: l })) : [{ value: "", label: "无分级" }], value: cat === "single" ? "核心主角" : "" },
      { key: "desc", label: "描述", rows: 5, placeholder: "仅描述该资产本身，遵守四类隔离原则" },
      { key: "words", label: "该资产参考词", rows: 2, placeholder: "风格/细节/参考角色等（生成提示词时使用）" },
      { key: "ep", label: "归属集数", type: "number", value: assetScope === "ep" ? scopeEp : activeEpisodeNo() },
    ],
    okLabel: "添加",
    onOk: (v) => {
      if (!v.name) {
        toast("请填写名称", "err");
        return false;
      }
      const item = mergeAsset(cat, { name: v.name, level: v.level || "", desc: v.desc || "" }, Number(v.ep));
      item.words = v.words || "";
      saveDraft();
      renderAllAssets();
      updateSplitProgress();
      updateNav();
      toast(`已添加${def.label}「${v.name}」`);
    },
  });
}

function editAssetModal(cat, id) {
  const item = findAssetById(cat, id);
  if (!item) return;
  const def = ASSET_CATS.find((c) => c.key === cat);
  fieldModal({
    title: `编辑${def.label}资产`,
    fields: [
      { key: "name", label: "名称", value: item.name },
      { key: "level", label: "分级", type: "select", options: cat === "single" ? ["核心主角", "次要配角"].map((l) => ({ value: l, label: l })) : [{ value: "", label: "无分级" }], value: item.level || "" },
      { key: "desc", label: "描述", rows: 6, value: item.desc },
      { key: "words", label: "该资产参考词", rows: 2, value: item.words || "" },
    ],
    okLabel: "保存",
    onOk: (v) => {
      if (!v.name) {
        toast("请填写名称", "err");
        return false;
      }
      item.name = v.name;
      item.key = dedupeKey(cat, v.name);
      item.level = v.level || "";
      item.desc = v.desc || "";
      item.words = v.words || "";
      saveDraft();
      renderAllAssets();
      import("./prompts.js").then((m) => m.renderPrompts());
      toast("资产已更新");
    },
  });
}

// ---------- 生成提示词 ----------

export async function generatePromptForItem(cat, item) {
  const promptList = (state.prompts[cat] ||= []);
  const existing = promptList.find((p) => p.assetId === item.id);
  const def = ASSET_CATS.find((c) => c.key === cat);
  const words = (item.words || "").trim();
  try {
    const text = await aiCall({
      system: promptSystem(cat, item),
      user: `请为以下【${def.label}】资产生成高质量提示词：\n资产名称：${item.name}\n资产描述：${item.desc || "（无）"}\n${words ? "该资产参考词：" + words + "\n" : ""}\n\n只输出提示词正文，不要解释。`,
    });
    if (existing) existing.text = text.trim();
    else promptList.push({ id: uid(), assetId: item.id, name: item.name, text: text.trim() });
    saveDraft();
    toast(`已生成「${item.name}」提示词`);
    import("./prompts.js").then((m) => m.renderPrompts());
    return text.trim();
  } catch (err) {
    toast("生成失败：" + err.message, "err");
    throw err;
  }
}

export function promptSystem(cat, item) {
  const style = stylePrefix();
  const ref = state.settings.assetStylePrompt || "";
  const rule = state.settings.assetPromptRule || "";
  const prefix = state.settings.prefixWords || "";
  const words = (item.words || "").trim();
  const def = ASSET_CATS.find((c) => c.key === cat);
  const isolation = cat === "single"
    ? "只描述该单人人物本身：外貌、体型、年龄、发型、穿搭、气质、特征；严禁出现任何场景环境、道具、背景信息。"
    : cat === "group"
    ? "只描述群像整体：人数、站位、服装差异、普通大众面容（不美化）；严禁出现场景环境、道具、背景信息。"
    : cat === "scene"
    ? "只描述场景空间：结构、环境、光影、天气、装修、氛围；严禁出现任何人物、角色、人影与动作。"
    : "只描述道具本身：造型、材质、颜色、尺寸、磨损、细节；严禁出现人物与场景。";
  return `你是专业的 AI 漫剧资产提示词设计师。请参考以下风格示例与规则生成可直接用于 AI 绘图/建模的高质量提示词。

【风格示例参考】
${ref || "（无）"}

【通用生成规则（务必严格遵守）】
${rule || "1. 人物、场景、道具三类内容完全隔离。\n2. 人物区分单人与群像，单人突出唯一主体，群像写清人数站位与普通大众面容。\n3. 提示词符合剧本时代与故事背景，专业明确可执行。"}

【生成规则】
1. ${isolation}
2. ${prefix ? `结合全局配置前缀词：${prefix}` : "无额外前缀词。"}
3. ${words ? `结合该资产参考词：${words}` : "无该资产参考词。"}
4. 提示词必须符合剧本时代与故事背景，语言专业、明确、可执行，避免空泛。
${style ? `5. 本剧视觉类型：${style}。` : ""}
6. 只输出提示词正文。`;
}
