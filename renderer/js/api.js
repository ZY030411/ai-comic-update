// ============================================================
// AI 大模型调用封装（流式、取消、JSON 提取）
// ============================================================

import { state } from "./state.js";

let activeConsumer = null;
let activeCount = 0;

window.api.onLlmChunk((delta) => {
  if (activeConsumer) activeConsumer(delta);
});

export function isRunning() {
  return activeCount > 0;
}

export function cancelLLM() {
  window.api.llmCancel();
}

export async function aiCall({ system, user, onChunk, label }) {
  const settings = state.settings;
  if (!settings.apiKey) {
    throw new Error("尚未填写 API Key，请在右侧「AI 模型设置」中配置");
  }
  if (!settings.model) {
    throw new Error("尚未填写模型名称");
  }
  if (!settings.baseUrl) {
    throw new Error("尚未填写接口地址");
  }

  activeCount++;
  activeConsumer = onChunk || null;
  try {
    const res = await window.api.llmChat({
      settings: {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    if (!res.ok) {
      const detail = res.detail ? `（${res.detail.slice(0, 200)}）` : "";
      throw new Error(`${res.error || "调用失败"}${detail}`);
    }
    return res.text;
  } finally {
    activeCount--;
    activeConsumer = null;
  }
}

export function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();

  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) {
    t = t.slice(first, last + 1);
  }
  try {
    return JSON.parse(t);
  } catch {}

  // 尝试修复：去掉尾随逗号
  try {
    const fixed = t.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixed);
  } catch {}
  return null;
}

export function splitGroups(text) {
  const re = /(第\s*\d+\s*组[\s\S]*?)(?=第\s*\d+\s*组|$)/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const block = m[1].trim();
    if (block) out.push(block);
  }
  if (!out.length && String(text || "").trim()) out.push(String(text).trim());
  return out;
}

export function extractDuration(text) {
  const m = String(text || "").match(/总时长[：:]\s*(\d+(?:\.\d+)?)\s*秒/);
  return m ? Number(m[1]) : null;
}
