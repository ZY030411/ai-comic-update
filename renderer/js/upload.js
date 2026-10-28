// ============================================================
// Tab 1：上传剧本
// ============================================================

import { state, getEpisodes, saveDraft, replaceState, deepClone, activeEpisodeNo } from "./state.js";
import { $, toast, busy, confirmModal } from "./ui.js";
import { parseEpisodes, countTextChars } from "./parser.js";
import { renderAssetEpisodes, renderAllAssets, updateSplitProgress } from "./assets.js";
import { renderPromptEpisodes, renderPrompts } from "./prompts.js";
import { renderSbGrid, renderStoryboard } from "./storyboard.js";
import { switchTab, setActiveEpisode, updateNav } from "./app.js";
import { petRemind, petDone, petSay } from "./pet.js";

let loadedFromPath = null;

export function initUpload() {
  const dz = $("#dropzone");
  const fileInput = $("#fileInput");

  const openPicker = async () => {
    const p = await window.api.openFile([
      { name: "剧本文件", extensions: ["txt", "docx"] },
      { name: "所有文件", extensions: ["*"] },
    ]);
    if (p) await loadFromPath(p);
  };

  dz.addEventListener("click", openPicker);
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (f) {
      const p = window.api.getPathForFile(f);
      if (p) await loadFromPath(p);
    }
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
    })
  );
  dz.addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      const p = window.api.getPathForFile(f);
      if (p) await loadFromPath(p);
    }
  });

  $("#btnSample").addEventListener("click", () => loadSample());
  $("#btnClearScript").addEventListener("click", () => clearScript());
  $("#btnChooseStyle").addEventListener("click", () => switchTab("style"));

}

export async function loadFromPath(p) {
  const btn = $("#btnChooseFile");
  busy(btn, true);
  try {
    const res = await window.api.readScript(p);
    if (!res.ok) {
      toast("读取失败：" + (res.error || "未知错误"), "err");
      return false;
    }
    loadedFromPath = p;
    applyScript(res.text, res.name);
    return true;
  } finally {
    busy(btn, false);
  }
}

export async function loadSample() {
  const res = await window.api.readSample("示例剧本.txt");
  if (!res.ok) {
    toast("示例剧本读取失败", "err");
    return;
  }
  loadedFromPath = null;
  applyScript(res.text, "示例剧本.txt");
  toast("已载入示例剧本《领主：开局流放海岛，结局一颗星球》");
}

export function applyScript(text, filename) {
  const episodes = parseEpisodes(text);
  state.script = {
    filename: filename || "未命名剧本.txt",
    text,
    episodes,
  };
  state.ui.activeEpisode = episodes.length ? Number(episodes[0].no) : 1;
  state.projectName = (filename || "未命名项目").replace(/\.(txt|docx)$/i, "");
  saveDraft();
  renderScriptInfo();
  renderAll();
  updateNav();
  petDone(`剧本已就绪：共 ${episodes.length} 集！`);
  toast(`已解析剧本：共 ${episodes.length} 集，${countTextChars(text)} 字`);
}

export function renderScriptInfo() {
  const card = $("#scriptInfoCard");
  const eps = getEpisodes();
  card.hidden = !eps.length;
  if (!eps.length) return;

  $("#infoName").textContent = state.script.filename || "—";
  $("#infoChars").textContent = countTextChars(state.script.text).toLocaleString();
  $("#infoEpisodes").textContent = eps.length;
  $("#infoScenes").textContent = eps.reduce((s, e) => s + e.scenes.length, 0);
  $("#scriptPreview").value = state.script.text || "";
  $("#scriptStatusBadge").textContent = state.genType ? "已选风格" : "待选择风格";
  $("#scriptStatusBadge").className = "badge " + (state.genType ? "green" : "gray");

  renderUploadEpisodes();
}

function renderUploadEpisodes() {
  const wrap = $("#uploadEpisodes");
  wrap.innerHTML = "";
  const eps = getEpisodes();
  if (!eps.length) return;
  for (const ep of eps) {
    const btn = document.createElement("button");
    btn.className = "ep-chip";
    btn.textContent = `第${ep.no}集`;
    btn.title = `查看第 ${ep.no} 集（${ep.scenes.length} 个场次）`;
    btn.addEventListener("click", () => {
      setActiveEpisode(ep.no);
      switchTab("assets");
    });
    wrap.appendChild(btn);
  }
}

function clearScript() {
  confirmModal("清空剧本", "将同时清空资产、提示词与分镜数据，且无法撤销。确定继续吗？", () => {
    loadedFromPath = null;
    const fresh = deepClone({ ...state });
    fresh.script = { filename: "", text: "", episodes: [] };
    fresh.assets = {};
    fresh.prompts = {};
    fresh.storyboard.byEpisode = {};
    replaceState(fresh);
    renderAll();
    updateNav();
    toast("已清空当前项目数据");
  });
}

export function renderAll() {
  renderScriptInfo();
  renderAssetEpisodes();
  renderAllAssets();
  updateSplitProgress();
  renderPromptEpisodes();
  renderPrompts();
  renderSbGrid();
  renderStoryboard();
  updateNav();
}

export function getLoadedPath() {
  return loadedFromPath;
}
