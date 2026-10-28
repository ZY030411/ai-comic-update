// ============================================================
// Tab 5：分镜生成编辑（集数网格/多选批量/组标签/预览/导出/自定义改写）
// ============================================================

import { state, getEpisodes, ensureStoryboard, saveDraft, uid, activeEpisodeNo } from "./state.js";
import { $, $$, toast, busy, esc, confirmModal, copyText, modal } from "./ui.js";
import { aiCall, splitGroups, extractDuration } from "./api.js";
import { stylePrefix } from "./style.js";
import { setActiveEpisode, switchTab, updateNav } from "./app.js";
import { petWorking, petDone } from "./pet.js";

let multiMode = false;
const selectedEps = new Set();
let activeGroupIdx = -1; // -1 = 全部

export function initStoryboard() {
  $("#ruleCardHead").addEventListener("click", () => {
    const body = $("#ruleBody");
    const closed = body.classList.toggle("closed");
    $("#ruleArrow").textContent = closed ? "▸" : "▾";
  });
  $("#ruleText").addEventListener("change", () => {
    state.storyboard.ruleText = $("#ruleText").value;
    saveDraft();
    toast("分镜规则已保存");
  });
  $("#btnSaveSbRule").addEventListener("click", () => {
    state.storyboard.ruleText = $("#ruleText").value;
    saveDraft();
    toast("已保存分镜规则");
  });
  $("#btnLoadRuleSample").addEventListener("click", () => loadRuleFrom("sample"));
  $("#btnResetRule").addEventListener("click", () => loadRuleFrom("default"));
  $("#btnImportRuleFile").addEventListener("click", () => importRuleFile());

  $("#btnToggleRule").addEventListener("click", () => {
    const body = $("#ruleBody");
    const closed = body.classList.toggle("closed");
    $("#ruleArrow").textContent = closed ? "▸" : "▾";
  });

  $("#btnGenStoryboard").addEventListener("click", () => generateCurrent());
  $("#btnGenAllSb").addEventListener("click", () => generateAllEps());
  $("#sbMultiToggle").addEventListener("click", () => {
    multiMode = !multiMode;
    selectedEps.clear();
    $("#sbMultiToggle").classList.toggle("active", multiMode);
    $("#sbMultiToggle").textContent = multiMode ? "✓ 多选模式" : "勾选多集批量";
    renderSbGrid();
    toast(multiMode ? "已进入多选模式，点击集数进行勾选" : "已退出多选模式", multiMode ? "ok" : "err");
  });

  $("#sbSearch").addEventListener("input", (e) => filterGrid(e.target.value));
  $("#sbEpToggle").addEventListener("click", () => {
    const g = $("#sbGrid");
    const open = g.hidden;
    g.hidden = !open;
    $("#sbEpToggle").textContent = open ? "📂 全部分镜集数（收起）" : "📂 全部分镜集数（展开）";
  });

  $("#sbGroupTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".sb-group-tab");
    if (!tab) return;
    activeGroupIdx = Number(tab.dataset.idx);
    renderStoryboard();
  });

  $("#sbPrevGroup").addEventListener("click", () => navGroup(-1));
  $("#sbNextGroup").addEventListener("click", () => navGroup(1));
  $("#sbAddGroup").addEventListener("click", () => addGroup());
  $("#sbPreviewGroup").addEventListener("click", () => previewGroup());
  $("#sbCopyGroup").addEventListener("click", () => copyGroup());
  $("#sbExportTxt").addEventListener("click", () => exportTxt());
  $("#sbRewriteGroup").addEventListener("click", () => rewriteGroup());

  $("#sbGroups").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const epNo = activeEpisodeNo();
    const list = ensureStoryboard(epNo);
    const group = list.find((g) => g.id === id);
    if (!group) return;
    if (act === "copy") await copyText(group.text);
    else if (act === "regen") await regenerateGroup(epNo, group);
    else if (act === "rewrite") rewriteGroupAt(epNo, group.id);
    else if (act === "del") {
      confirmModal("删除分镜组", `确定删除「${group.title}」吗？`, () => {
        const idx = list.findIndex((g) => g.id === id);
        if (idx >= 0) list.splice(idx, 1);
        if (activeGroupIdx >= list.length) activeGroupIdx = list.length - 1;
        saveDraft();
        renderStoryboard();
        updateNav();
        toast("已删除分镜组");
      });
    }
  });

  renderRuleText();
}

export function renderRuleText() {
  $("#ruleText").value = state.storyboard.ruleText || "";
  $("#ruleFileHint").textContent = state.storyboard.ruleFile ? `当前规则：${state.storyboard.ruleFile}` : "当前规则：内置分镜优化师规则";
}

async function loadRuleFrom(kind) {
  const res = await window.api.readSample("分镜优化师规则.txt");
  if (!res.ok) {
    toast("内置规则读取失败", "err");
    return;
  }
  state.storyboard.ruleText = res.text;
  state.storyboard.ruleFile = "";
  saveDraft();
  renderRuleText();
  toast(kind === "default" ? "已恢复内置默认规则" : "已载入内置分镜优化师规则");
}

async function importRuleFile() {
  const p = await window.api.openFile([{ name: "规则/提示词文件", extensions: ["txt", "md", "docx"] }, { name: "所有文件", extensions: ["*"] }]);
  if (!p) return;
  const res = await window.api.readText(p);
  if (!res.ok) {
    toast("读取失败：" + res.error, "err");
    return;
  }
  state.storyboard.ruleText = res.text;
  state.storyboard.ruleFile = res.name;
  saveDraft();
  renderRuleText();
  toast(`已导入规则文件：${res.name}`);
}

// ---------- 集数网格 ----------

function filterGrid(query) {
  const q = String(query || "").trim();
  $$("#sbGrid .sb-chip").forEach((chip) => {
    const no = Number(chip.dataset.no);
    if (!q) {
      chip.classList.remove("hidden");
      return;
    }
    let match = false;
    for (const token of q.split(/[,，、\s]+/)) {
      if (!token) continue;
      if (token === "全部") { match = true; break; }
      if (/^\d+$/.test(token) && no === Number(token)) { match = true; break; }
      const range = token.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (range && no >= Number(range[1]) && no <= Number(range[2])) { match = true; break; }
    }
    chip.classList.toggle("hidden", !match);
  });
}

export function renderSbGrid() {
  const wrap = $("#sbGrid");
  const eps = getEpisodes();
  wrap.innerHTML = "";
  if (!eps.length) {
    const tip = document.createElement("div");
    tip.className = "empty-tip";
    tip.textContent = "请先在上传剧本中载入剧本";
    wrap.appendChild(tip);
    return;
  }
  const active = activeEpisodeNo();
  for (const ep of eps) {
    const groups = state.storyboard.byEpisode[ep.no] || [];
    const done = groups.length > 0;
    const selected = selectedEps.has(ep.no);
    const chip = document.createElement("button");
    chip.className = "sb-chip" + (Number(ep.no) === active ? " active" : "") + (done ? " done" : "") + (multiMode ? " multi" : "") + (selected ? " selected" : "");
    chip.dataset.no = ep.no;
    chip.innerHTML = `${multiMode ? '<span class="sb-check">✓</span>' : ""}第${ep.no}集<span class="sb-status">${done ? `已生成 ${groups.length} 组` : "未生成"}</span>`;
    chip.title = `第 ${ep.no} 集${done ? `（${groups.length} 组）` : ""}`;
    chip.addEventListener("click", () => {
      if (multiMode) {
        if (selectedEps.has(ep.no)) selectedEps.delete(ep.no);
        else selectedEps.add(ep.no);
        renderSbGrid();
      } else {
        setActiveEpisode(ep.no);
        activeGroupIdx = -1;
        renderSbGrid();
        renderStoryboard();
      }
    });
    wrap.appendChild(chip);
  }
  updateSbSelectedInfo();
}

function updateSbSelectedInfo() {
  if (multiMode && selectedEps.size) {
    const nos = [...selectedEps].sort((a, b) => a - b).join("、");
    $("#sbSelectedInfo").textContent = `已勾选：第${nos} 集（共 ${selectedEps.size} 集）`;
  } else {
    $("#sbSelectedInfo").textContent = "";
  }
}

// ---------- 生成 ----------

function sbSystemPrompt() {
  const rule = state.storyboard.ruleText || "你是专业的 AI 漫剧镜头与视觉优化师。";
  const style = stylePrefix();
  const example = state.settings.storyboardExample || "";
  return `${rule}

${style ? `【本剧视觉类型】${style}` : ""}
【输出格式参考示例】
${example || "（无示例）"}

【硬性要求】
1. 严格按照剧本集数划分分镜分组，每组总时长不超过 15 秒，超出必须自动拆组。
2. 台词一字不改，且必须绑定到对应镜头。
3. 每个镜头写清：景别、运镜/固定、拍摄角度、机位关系、时长、画面内容、特效/环境动态。
4. 单人近景/特写默认只保留当前角色入镜，交流对象用画外化表达。
5. 输出使用「第X组」开头，每组末尾包含：总时长、衔接提示、本组情绪重点、本组视觉重点、时长校验说明。
6. 只输出分镜正文，不要输出解释。`;
}

async function generateForEpisode(no) {
  const ep = getEpisodes().find((e) => Number(e.no) === no);
  if (!ep) return 0;
  const user = `这是第 ${no} 集的完整剧本：\n\n${ep.raw || ep.title || ""}\n\n请严格按照规则，将本集剧本拆分为若干分镜组，每组不超过 15 秒，输出全部「第X组」内容。`;
  const text = await aiCall({ system: sbSystemPrompt(), user });
  const blocks = splitGroups(text);
  if (!blocks.length) throw new Error(`第 ${no} 集未生成有效分镜内容`);
  const newGroups = blocks.map((b, i) => {
    const m = b.match(/第\s*\d+\s*组/);
    return { id: uid(), title: m ? m[0] : `第 ${i + 1} 组`, text: b };
  });
  state.storyboard.byEpisode[no] = newGroups;
  saveDraft();
  return newGroups.length;
}

export async function generateCurrent() {
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
  const no = activeEpisodeNo();
  const btn = $("#btnGenStoryboard");
  busy(btn, true);
  petWorking();
  $("#splitDetail").classList.add("busy");
  $("#splitDetail").textContent = `正在为第 ${no} 集生成分镜…`;
  setProgressBg(20);
  try {
    const n = await generateForEpisode(no);
    setProgressBg(100);
    petDone(`第 ${no} 集分镜生成完成，共 ${n} 组`);
  } catch (err) {
    toast("生成失败：" + err.message, "err");
  } finally {
    busy(btn, false);
    $("#splitDetail").classList.remove("busy");
  }
  activeGroupIdx = -1;
  renderSbGrid();
  renderStoryboard();
  updateNav();
}

export async function generateAllEps() {
  const eps = getEpisodes();
  if (!eps.length) {
    toast("请先载入剧本", "err");
    return;
  }
  if (!state.settings.apiKey) {
    toast("请先在右侧「AI 模型设置」中配置 API Key", "err");
    return;
  }
  const targets = multiMode && selectedEps.size ? [...selectedEps].sort((a, b) => a - b) : eps.map((e) => e.no);
  const btn = $("#btnGenAllSb");
  busy(btn, true);
  petWorking();
  let ok = 0;
  let fail = 0;
  try {
    for (let i = 0; i < targets.length; i++) {
      $("#splitDetail").classList.add("busy");
      $("#splitDetail").textContent = `正在为第 ${targets[i]} 集生成分镜（${i + 1}/${targets.length}）…`;
      setProgressBg((i / targets.length) * 100);
      try {
        const n = await generateForEpisode(targets[i]);
        ok += n;
      } catch {
        fail++;
      }
    }
    setProgressBg(100);
  } finally {
    busy(btn, false);
    $("#splitDetail").classList.remove("busy");
    petDone(fail === 0 ? `分镜生成完成：共 ${ok} 组` : `分镜生成结束：成功 ${ok} 组，失败 ${fail} 集`);
  }
  activeGroupIdx = -1;
  renderSbGrid();
  renderStoryboard();
  updateNav();
}

function setProgressBg(pct) {
  const bar = $("#splitBar");
  if (bar) bar.style.width = pct + "%";
  const num = $("#splitPercent");
  if (num) num.textContent = Math.round(pct) + "%";
}

// ---------- 组标签/导航 ----------

function navGroup(dir) {
  const list = ensureStoryboard(activeEpisodeNo());
  if (!list.length) return;
  activeGroupIdx = activeGroupIdx < 0 ? 0 : Math.min(list.length - 1, Math.max(0, activeGroupIdx + dir));
  renderStoryboard();
}

function addGroup() {
  const epNo = activeEpisodeNo();
  const list = ensureStoryboard(epNo);
  list.push({ id: uid(), title: `第 ${list.length + 1} 组`, text: `第 ${list.length + 1} 组\n位置状态与场景：\n【\n镜头1：\n【近景】，【固定】，【平拍】，【3秒】。\n【\n特效/环境动态：\n【无明显特效，保持画面干净】\n台词：\n【角色名】（【语气】）：\n“【原台词】”\n总时长： 3秒。\n衔接提示： \n本组情绪重点： \n本组视觉重点： \n时长校验说明： ` });
  saveDraft();
  activeGroupIdx = list.length - 1;
  renderStoryboard();
  toast("已新增一组，可自由编辑内容");
}

function currentGroup() {
  const list = ensureStoryboard(activeEpisodeNo());
  if (!list.length) return null;
  return list[activeGroupIdx >= 0 && activeGroupIdx < list.length ? activeGroupIdx : 0];
}

async function copyGroup() {
  const g = currentGroup();
  if (!g) {
    toast("当前集暂无分镜组");
    return;
  }
  await copyText(g.text);
}

function previewGroup() {
  const g = currentGroup();
  if (!g) {
    toast("当前集暂无分镜组");
    return;
  }
  const body = document.createElement("div");
  const ref = document.createElement("div");
  ref.className = "rewrite-ref";
  ref.textContent = g.text;
  body.appendChild(ref);
  modal({
    title: `${g.title} · 单组预览`,
    body,
    actions: [
      { label: "关闭", className: "btn ghost" },
      { label: "复制", className: "btn primary", onClick: () => { copyText(g.text); return false; } },
    ],
  });
}

async function exportTxt() {
  const epNo = activeEpisodeNo();
  const list = ensureStoryboard(epNo);
  if (!list.length) {
    toast("当前集暂无分镜，无法导出", "err");
    return;
  }
  const content = `第 ${epNo} 集分镜\n\n` + list.map((g) => g.text).join("\n\n");
  const p = await window.api.saveText(`第${epNo}集_分镜.txt`);
  if (!p) return;
  const res = await window.api.writeText(p, content);
  if (res.ok) toast("已导出：" + p.split(/[\\/]/).pop());
  else toast("导出失败：" + res.error, "err");
}

// ---------- 渲染 ----------

export function renderStoryboard() {
  const epNo = activeEpisodeNo();
  const groups = ensureStoryboard(epNo);
  const head = $("#sbEpisodeHead");
  const wrap = $("#sbGroups");
  const tabs = $("#sbGroupTabs");
  wrap.innerHTML = "";
  tabs.innerHTML = "";

  if (!getEpisodes().length) {
    head.hidden = true;
    wrap.appendChild(emptyState("📄", "还没有剧本", "请先在「上传剧本」中载入剧本，再生成分镜"));
    return;
  }

  head.hidden = false;
  const total = groups.reduce((s, g) => s + (extractDuration(g.text) || 0), 0);
  head.innerHTML = `<h3 id="sbEpisodeTitle">第 ${epNo} 集 · 分镜</h3><span class="sb-summary" id="sbSummary">${groups.length} 组 · 合计 ${total} 秒</span>`;

  const allTab = document.createElement("button");
  allTab.className = "sb-group-tab" + (activeGroupIdx < 0 ? " active" : "");
  allTab.dataset.idx = "-1";
  allTab.textContent = "全部";
  tabs.appendChild(allTab);
  groups.forEach((g, i) => {
    const tab = document.createElement("button");
    tab.className = "sb-group-tab" + (activeGroupIdx === i ? " active" : "");
    tab.dataset.idx = String(i);
    tab.textContent = g.title || `第 ${i + 1} 组`;
    tabs.appendChild(tab);
  });

  if (!groups.length) {
    wrap.appendChild(emptyState("🎬", "本集尚未生成分镜", "点击上方「生成当前集分镜」，或「＋ 新增一组」手动添加"));
    return;
  }

  const shown = activeGroupIdx < 0 ? groups : [groups[activeGroupIdx]];
  for (const g of shown) {
    const el = document.createElement("div");
    el.className = "sb-group";
    const dur = extractDuration(g.text);
    el.innerHTML = `
      <div class="sb-group-head">
        <span class="sb-group-title">${esc(g.title || "第 1 组")}</span>
        <span class="sb-group-dur">${dur ? dur + " 秒" : "时长未标注"}</span>
        <span class="sb-group-actions">
          <button class="mini-btn" data-act="copy" data-id="${g.id}">复制</button>
          <button class="mini-btn" data-act="regen" data-id="${g.id}">优化重生成</button>
          <button class="mini-btn" data-act="rewrite" data-id="${g.id}">自定义改写</button>
          <button class="mini-btn" data-act="del" data-id="${g.id}">删除</button>
        </span>
      </div>
      <div class="sb-group-body">
        <textarea class="sb-group-text mono" data-gid="${g.id}">${esc(g.text)}</textarea>
      </div>`;
    const ta = el.querySelector("textarea");
    ta.addEventListener("change", () => {
      g.text = ta.value;
      saveDraft();
      renderStoryboard();
      toast("分镜内容已保存");
    });
    wrap.appendChild(el);
  }
}

function emptyState(icon, title, sub) {
  const el = document.createElement("div");
  el.className = "empty-state";
  el.innerHTML = `<span class="es-ic">${icon}</span><div class="es-title">${esc(title)}</div><div class="es-sub">${esc(sub)}</div>`;
  return el;
}

async function regenerateGroup(epNo, group) {
  const btn = $(`button[data-act="regen"][data-id="${group.id}"]`);
  busy(btn, true);
  try {
    const text = await aiCall({
      system: sbSystemPrompt(),
      user: `这是第 ${epNo} 集的分镜组（请保留原台词一字不改，按规则优化重写）：\n\n${group.text}\n\n只输出优化后的分镜内容。`,
    });
    const blocks = splitGroups(text);
    group.text = blocks[0] || text.trim();
    saveDraft();
    renderStoryboard();
    toast("分镜组已优化重生成");
  } catch (err) {
    toast("重生成失败：" + err.message, "err");
  } finally {
    busy(btn, false);
  }
}

// ---------- 自定义改写分镜 ----------

function rewriteGroup() {
  const g = currentGroup();
  if (!g) {
    toast("当前集暂无分镜组", "err");
    return;
  }
  rewriteGroupAt(activeEpisodeNo(), g.id);
}

function rewriteGroupAt(epNo, groupId) {
  const list = ensureStoryboard(epNo);
  const group = list.find((g) => g.id === groupId) || list[0];
  if (!group) return;

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="field"><span class="field-label">当前组内容（参考）</span>
      <div class="rewrite-ref" id="rwRef">${esc(group.text)}</div>
    </div>
    <div class="field"><span class="field-label">粘贴你自己的分镜草稿（位置 / 动作 / 台词）</span>
      <textarea class="textarea" id="rwDraft" rows="5" placeholder="例如：白天，出租屋内，林默坐在地上，背靠床沿，橘猫吃猫粮。林默：……（正面近景）"></textarea>
    </div>
    <div class="rewrite-hint">提示：台词一字不改保留；不写台词则该组无台词栏。点击「生成分镜提示词」后会按规则优化成规范格式。</div>
    <textarea class="textarea mono" id="rwResult" rows="8" placeholder="生成结果将显示在这里（可手动修改后点「替换该组」保存）"></textarea>
  `;
  modal({
    title: `自定义改写分镜：第 ${epNo} 集 · ${group.title}`,
    body,
    actions: [
      { label: "取消", className: "btn ghost" },
      {
        label: "生成分镜提示词",
        className: "btn primary",
        onClick: async () => {
          const draft = $("#rwDraft").value.trim();
          if (!draft) {
            toast("请先粘贴你的分镜草稿", "err");
            return false;
          }
          const genBtn = document.querySelector(".modal-actions .btn.primary");
          busy(genBtn, true);
          try {
            const text = await aiCall({
              system: sbSystemPrompt(),
              user: `这是我为本组写的分镜草稿，请按规则优化成规范分镜提示词（保持台词一字不改）：\n\n${draft}\n\n只输出优化后的分镜内容。`,
            });
            $("#rwResult").value = text.trim();
            toast("已生成，可点击「替换该组」保存");
          } catch (err) {
            toast("生成失败：" + err.message, "err");
          } finally {
            busy(genBtn, false);
          }
          return false;
        },
      },
      {
        label: "复制结果",
        className: "btn ghost",
        onClick: () => {
          const v = $("#rwResult").value;
          if (!v) {
            toast("结果为空", "err");
            return false;
          }
          copyText(v);
          return false;
        },
      },
      {
        label: "替换该组",
        className: "btn primary",
        onClick: () => {
          const v = $("#rwResult").value.trim();
          if (!v) {
            toast("请先生成或填写内容", "err");
            return false;
          }
          group.text = v;
          saveDraft();
          renderStoryboard();
          toast(`已替换「${group.title}」`);
        },
      },
    ],
  });
}
