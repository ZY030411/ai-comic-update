// ============================================================
// Tab 4：资产提示词生成（每项资产独立参考词 + 全局前缀词）
// ============================================================

import { state, getEpisodes, saveDraft, activeEpisodeNo, ASSET_CATS, assetsOf, promptsOf } from "./state.js";
import { $, $$, toast, busy, esc, confirmModal, setProgress } from "./ui.js";
import { generatePromptForItem } from "./assets.js";
import { setActiveEpisode } from "./app.js";
import { petWorking, petDone } from "./pet.js";

let catFilter = "all";
let searchText = "";
let allMode = false;

export function initPrompts() {
  // 资产提示词规则配置
  const defaultRule =
    "1. 人物、场景、道具三类内容完全隔离：人物提示词不得包含场景与道具，场景提示词不得包含人物，道具提示词不得包含人物与场景。\n" +
    "2. 人物区分单人与群像：单人突出唯一主体；群像写清人数、站位、服装差异、普通大众面容（不美化）。\n" +
    "3. 结合该资产的参考词与全局配置前缀词。\n" +
    "4. 提示词符合剧本时代与故事背景，语言专业、明确、可执行，避免空泛。\n" +
    "5. 只输出提示词正文。";
  $("#scoreRuleHead").addEventListener("click", () => {
    const closed = $("#scoreRuleBody").classList.toggle("closed");
    $("#scoreRuleArrow").textContent = closed ? "▸" : "▾";
  });
  $("#scoreStyleText").addEventListener("change", () => {
    state.settings.assetStylePrompt = $("#scoreStyleText").value;
    saveDraft();
    toast("已保存提示词风格示例参考");
  });
  $("#scoreRuleText").addEventListener("change", () => {
    state.settings.assetPromptRule = $("#scoreRuleText").value;
    saveDraft();
    toast("已保存提示词生成规则");
  });
  $("#btnLoadScoreRule").addEventListener("click", async () => {
    const res = await window.api.readSample("资产提示词参考.txt");
    if (!res.ok) {
      toast("内置参考读取失败", "err");
      return;
    }
    $("#scoreStyleText").value = res.text;
    if (!state.settings.assetStylePrompt) state.settings.assetStylePrompt = res.text;
    saveDraft();
    $("#scoreRuleText").value = defaultRule;
    if (!state.settings.assetPromptRule) state.settings.assetPromptRule = defaultRule;
    saveDraft();
    toast("已载入内置提示词参考与默认规则");
  });
  $("#btnResetScoreRule").addEventListener("click", async () => {
    const res = await window.api.readSample("资产提示词参考.txt");
    if (res.ok) {
      state.settings.assetStylePrompt = res.text;
      $("#scoreStyleText").value = res.text;
    }
    state.settings.assetPromptRule = defaultRule;
    $("#scoreRuleText").value = defaultRule;
    saveDraft();
    toast("已恢复默认提示词规则");
  });
  $("#btnSaveScoreRule").addEventListener("click", () => {
    state.settings.assetStylePrompt = $("#scoreStyleText").value;
    state.settings.assetPromptRule = $("#scoreRuleText").value;
    saveDraft();
    toast("已保存资产提示词规则");
  });
  $("#scoreStyleText").value = state.settings.assetStylePrompt || "";
  $("#scoreRuleText").value = state.settings.assetPromptRule || defaultRule;

  $("#btnGenAllPrompts").addEventListener("click", () => generateAll());
  $("#btnClearPrompts").addEventListener("click", () => clearAllPrompts());
  $("#promptSearch").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderPrompts();
  });
  $("#promptEpisodeSel").addEventListener("change", (e) => {
    if (e.target.value === "all") allMode = true;
    else {
      allMode = false;
      setActiveEpisode(Number(e.target.value));
    }
    renderPromptEpisodes();
    renderPrompts();
  });
  $$("#promptCatChips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      catFilter = chip.dataset.cat;
      $$("#promptCatChips .chip").forEach((c) => c.classList.toggle("active", c === chip));
      renderPrompts();
    });
  });
  $("#cfgPrefix").addEventListener("change", () => {
    state.settings.prefixWords = $("#cfgPrefix").value.trim();
    saveDraft();
    toast("已保存全局配置前缀词");
  });

  $("#promptList").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const cat = btn.dataset.cat;
    const item = assetsOf(cat).find((a) => a.id === id);
    if (!item) return;
    if (act === "copy") await copyPromptText(cat, item);
    else if (act === "regen") {
      await generatePromptForItem(cat, item);
      renderPrompts();
    } else if (act === "del") {
      confirmModal("删除提示词", `确定删除「${item.name}」的提示词吗？`, () => {
        const list = promptsOf(cat);
        const idx = list.findIndex((p) => p.assetId === item.id);
        if (idx >= 0) list.splice(idx, 1);
        saveDraft();
        renderPrompts();
        toast("已删除提示词");
      });
    }
  });

  $("#promptList").addEventListener("change", (e) => {
    const ta = e.target;
    if (ta.dataset.bind === "words") {
      const item = assetsOf(ta.dataset.cat).find((a) => a.id === ta.dataset.id);
      if (item) {
        item.words = ta.value;
        saveDraft();
      }
    } else if (ta.dataset.bind === "text") {
      const list = promptsOf(ta.dataset.cat);
      const p = list.find((x) => x.assetId === ta.dataset.id);
      if (p) {
        p.text = ta.value;
        saveDraft();
      }
    }
  });

  $("#cfgPrefix").value = state.settings.prefixWords || "";
}

async function copyPromptText(cat, item) {
  const p = promptsOf(cat).find((x) => x.assetId === item.id);
  if (!p || !p.text) {
    toast("该资产尚未生成提示词", "err");
    return;
  }
  try {
    await navigator.clipboard.writeText(p.text);
    toast("已复制到剪贴板");
  } catch {
    toast("复制失败", "err");
  }
}

export function renderPromptEpisodes() {
  const sel = $("#promptEpisodeSel");
  const eps = getEpisodes();
  const active = activeEpisodeNo();
  sel.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "全部集数";
  allOpt.selected = allMode;
  sel.appendChild(allOpt);
  if (!eps.length) {
    allOpt.disabled = true;
    return;
  }
  for (const ep of eps) {
    const opt = document.createElement("option");
    opt.value = ep.no;
    opt.textContent = `第 ${ep.no} 集`;
    opt.selected = !allMode && Number(ep.no) === active;
    sel.appendChild(opt);
  }
}

export function setPromptCategory(cat) {
  catFilter = cat;
  $$("#promptCatChips .chip").forEach((c) => c.classList.toggle("active", c.dataset.cat === cat));
  renderPrompts();
}

function collectAssets() {
  const entries = [];
  for (const cat of ASSET_CATS) {
    for (const a of assetsOf(cat.key)) entries.push({ asset: a, cat: cat.key });
  }
  return entries;
}

export function renderPrompts() {
  const wrap = $("#promptList");
  wrap.innerHTML = "";
  if (!getEpisodes().length) {
    wrap.appendChild(emptyState("📄", "还没有剧本", "请先在「上传剧本」中载入剧本"));
    return;
  }
  const entries = collectAssets().filter((x) => {
    if (catFilter !== "all" && x.cat !== catFilter) return false;
    if (!allMode && !(x.asset.episodes || []).map(Number).includes(activeEpisodeNo())) return false;
    if (searchText) {
      return (
        x.asset.name.toLowerCase().includes(searchText) ||
        x.asset.desc.toLowerCase().includes(searchText) ||
        (x.asset.words || "").toLowerCase().includes(searchText)
      );
    }
    return true;
  });
  if (!entries.length) {
    wrap.appendChild(emptyState(catFilter === "all" ? "🧩" : "🎯", "暂无匹配资产", "请先在「资产拆分与校验」中拆分资产，或调整筛选条件"));
    return;
  }

  for (const cat of ASSET_CATS) {
    const list = entries.filter((x) => x.cat === cat.key);
    if (!list.length) continue;
    const header = document.createElement("div");
    header.className = "prompt-cat-header";
    header.innerHTML = `<span class="badge ${cat.key === "scene" ? "blue" : cat.key === "prop" ? "amber" : "purple"}">${cat.icon} ${cat.label}</span><span class="badge gray">${list.length} 项</span>`;
    wrap.appendChild(header);

    for (const { asset } of list) {
      const prompt = promptsOf(cat.key).find((p) => p.assetId === asset.id);
      const eps = (asset.episodes || []).slice().sort((a, b) => a - b);
      const epsText = eps.length ? (eps.length > 6 ? `第${eps.slice(0, 6).join("、")}…等${eps.length}集` : `第${eps.join("、")}集`) : "全局";
      const tone = cat.key === "scene" ? "blue" : cat.key === "prop" ? "amber" : "purple";
      const el = document.createElement("div");
      el.className = "prompt-item" + (prompt?.text ? " generated" : "");
      el.innerHTML = `
        <div class="prompt-item-head">
          <span class="badge ${tone}">${cat.icon} ${cat.label}</span>
          <span class="prompt-name">${esc(asset.name)}</span>
          <span class="prompt-ep">${esc(epsText)}</span>
          <span class="prompt-item-actions">
            <button class="mini-btn" data-act="copy" data-id="${asset.id}" data-cat="${cat.key}">复制</button>
            <button class="mini-btn" data-act="regen" data-id="${asset.id}" data-cat="${cat.key}">${prompt?.text ? "重新生成" : "生成"}</button>
            ${prompt ? '<button class="mini-btn" data-act="del" data-id="' + asset.id + '" data-cat="' + cat.key + '">删除</button>' : ""}
          </span>
        </div>
        <label class="field"><span class="field-label">该资产的参考词（风格 / 细节 / 参考角色等）</span>
          <input class="input" data-bind="words" data-id="${asset.id}" data-cat="${cat.key}" value="${esc(asset.words || "")}" placeholder="例如：28岁古代御姐，清冷威严，瑶衣裙袍，暗银纹玉带…" />
        </label>
        <textarea class="textarea mono prompt-textarea" data-bind="text" data-id="${asset.id}" data-cat="${cat.key}" placeholder="${prompt ? "" : "点击「生成」为该资产生成提示词…"}">${esc(prompt?.text || "")}</textarea>`;
      wrap.appendChild(el);
    }
  }
}

function emptyState(icon, title, sub) {
  const el = document.createElement("div");
  el.className = "empty-state";
  el.innerHTML = `<span class="es-ic">${icon}</span><div class="es-title">${esc(title)}</div><div class="es-sub">${esc(sub)}</div>`;
  return el;
}

export async function generateAll() {
  if (!getEpisodes().length) {
    toast("请先载入剧本", "err");
    return;
  }
  const targets = collectAssets().filter((x) => {
    if (!allMode && !(x.asset.episodes || []).map(Number).includes(activeEpisodeNo())) return false;
    return !promptsOf(x.cat).some((p) => p.assetId === x.asset.id);
  });
  if (!targets.length) {
    toast("当前筛选下所有资产均已生成提示词", "err");
    return;
  }
  if (!state.settings.apiKey) {
    toast("请先在右侧「AI 模型设置」中配置 API Key", "err");
    return;
  }
  const btn = $("#btnGenAllPrompts");
  busy(btn, true);
  petWorking();
  let ok = 0, fail = 0;
  try {
    for (let i = 0; i < targets.length; i++) {
      const { asset, cat } = targets[i];
      const det = $("#splitDetail");
      det.classList.add("busy");
      det.textContent = `正在生成提示词：${asset.name}（${i + 1}/${targets.length}）…`;
      setProgress($("#splitBar"), $("#splitPercent"), (i / targets.length) * 100);
      try {
        await generatePromptForItem(cat, asset);
        ok++;
      } catch {
        fail++;
      }
    }
  } finally {
    busy(btn, false);
    $("#splitDetail").classList.remove("busy");
    petDone(fail === 0 ? `提示词生成完成：${ok} 条` : `提示词生成结束：成功 ${ok} 条，失败 ${fail} 条`);
  }
  renderPrompts();
  toast(fail === 0 ? `批量生成完成：${ok} 条` : `完成：成功 ${ok} 条，失败 ${fail} 条`, fail ? "err" : "ok");
}

function clearAllPrompts() {
  let count = 0;
  for (const cat of ASSET_CATS) {
    const list = promptsOf(cat.key);
    const filtered = allMode ? list : list.filter((p) => {
      const a = assetsOf(cat.key).find((x) => x.id === p.assetId);
      return a && (a.episodes || []).map(Number).includes(activeEpisodeNo());
    });
    count += filtered.length;
  }
  if (!count) {
    toast("当前筛选下暂无提示词");
    return;
  }
  confirmModal("清空提示词", `确定清空当前筛选的 ${count} 条提示词吗？`, () => {
    for (const cat of ASSET_CATS) {
      const list = promptsOf(cat.key);
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        if (allMode) list.splice(i, 1);
        else {
          const a = assetsOf(cat.key).find((x) => x.id === p.assetId);
          if (a && (a.episodes || []).map(Number).includes(activeEpisodeNo())) list.splice(i, 1);
        }
      }
    }
    saveDraft();
    renderPrompts();
    toast("已清空提示词");
  });
}
