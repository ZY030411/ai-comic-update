// ============================================================
// Tab 2：选择风格（AI真人漫剧 / 3D漫剧）
// ============================================================

import { state, saveDraft } from "./state.js";
import { $, toast } from "./ui.js";
import { renderScriptInfo } from "./upload.js";
import { updateNav } from "./app.js";
import { petDone } from "./pet.js";

export function initStyle() {
  const cards = [$("#styleAi3d"), $("#styleAiReal")];
  for (const card of cards) {
    card.addEventListener("click", () => {
      state.genType = card.dataset.gen;
      saveDraft();
      renderStyle();
      renderScriptInfo();
      updateNav();
      petDone(state.genType === "ai3d" ? "已选择：3D 漫剧 🧊" : "已选择：AI 真人漫剧 🎥");
      toast(state.genType === "ai3d" ? "已选择：3D 漫剧" : "已选择：AI 真人漫剧");
    });
  }
}

export function renderStyle() {
  const selected = state.genType;
  $("#styleAi3d").classList.toggle("selected", selected === "ai3d");
  $("#styleAiReal").classList.toggle("selected", selected === "aiReal");
}

export function stylePrefix() {
  if (state.genType === "ai3d") {
    return "3D 卡通渲染风格，三维立体质感，柔和光影，色彩明快，符合 2D/3D 漫剧视觉基调";
  }
  if (state.genType === "aiReal") {
    return "AI 真人漫剧风格，写实真人影像质感，电影感构图与光影，真实细腻的皮肤与材质";
  }
  return "";
}
