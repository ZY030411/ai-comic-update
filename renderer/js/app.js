// ============================================================
// AI漫剧工作站 · 应用入口
// ============================================================

import { state, saveDraft, restoreDraft, replaceState, deepClone, DEFAULT_STATE, getEpisodes, activeEpisodeNo } from "./state.js";
import { $, $$, toast, busy, modal, closeModal, confirmModal } from "./ui.js";
import { parseEpisodes } from "./parser.js";
import { aiCall, cancelLLM, isRunning } from "./api.js";
import * as pet from "./pet.js";
import * as upload from "./upload.js";
import * as style from "./style.js";
import * as assets from "./assets.js";
import * as prompts from "./prompts.js";
import * as storyboard from "./storyboard.js";
import * as calendar from "./calendar.js";

let lastProjectPath = null;

// ---------- 主题 ----------
export function applyTheme() {
  document.body.dataset.theme = state.ui.theme === "dark" ? "dark" : "light";
  $("#themeIcon").textContent = state.ui.theme === "dark" ? "🌙" : "☀️";
  $("#themeLabel").textContent = state.ui.theme === "dark" ? "黑夜模式" : "白天模式";
}

export function toggleTheme() {
  state.ui.theme = state.ui.theme === "dark" ? "light" : "dark";
  saveDraft();
  applyTheme();
}

// ---------- Tab ----------
export function switchTab(tab) {
  state.ui.activeTab = tab;
  saveDraft();
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.tab === tab));
  updateNav();

  if (tab === "upload") upload.renderScriptInfo();
  if (tab === "style") style.renderStyle();
  if (tab === "assets") {
    assets.renderAssetEpisodes();
    assets.renderAllAssets();
    assets.updateSplitProgress();
  }
  if (tab === "prompts") {
    prompts.renderPromptEpisodes();
    prompts.renderPrompts();
  }
  if (tab === "storyboard") {
    storyboard.renderSbGrid();
    storyboard.renderStoryboard();
  }
}

export function setActiveEpisode(no) {
  state.ui.activeEpisode = Number(no);
  saveDraft();
  updateNav();
}

// ---------- 导航 ----------
export function updateNav() {
  const eps = getEpisodes();
  const mark = (tab, done) => {
    const item = $(`.nav-item[data-tab="${tab}"]`);
    if (item) item.classList.toggle("done", !!done);
  };
  mark("upload", eps.length > 0);
  mark("style", !!state.genType);
  mark(
    "assets",
    Object.values(state.assets).some((a) => a && (a.characters?.length || a.scenes?.length || a.props?.length))
  );
  mark(
    "prompts",
    Object.values(state.prompts).some((a) =>
      a && (a.characters?.length || a.scenes?.length || a.props?.length)
    )
  );
  mark(
    "storyboard",
    Object.values(state.storyboard.byEpisode).some((g) => g && g.length)
  );

  // 工作流导航高亮当前 Tab
  $$(".nav-item[data-tab]").forEach((item) =>
    item.classList.toggle("active", item.dataset.tab === state.ui.activeTab)
  );

  // 分镜管理集数
  const wrap = $("#navEpisodes");
  wrap.innerHTML = "";
  for (const ep of eps) {
    const btn = document.createElement("button");
    const groups = state.storyboard.byEpisode[ep.no] || [];
    btn.className = "nav-ep" + (Number(ep.no) === activeEpisodeNo() ? " active" : "");
    btn.textContent = ep.no;
    btn.title = `第 ${ep.no} 集${groups.length ? `（${groups.length} 组分镜）` : ""}`;
    btn.addEventListener("click", () => {
      setActiveEpisode(ep.no);
      switchTab("storyboard");
    });
    wrap.appendChild(btn);
  }
}

// ---------- 项目 ----------
async function newProject() {
  confirmModal("新建项目", "将清空当前剧本、资产、提示词与分镜数据（AI 设置与主题保留）。确定继续吗？", () => {
    const fresh = deepClone(DEFAULT_STATE);
    fresh.settings = state.settings;
    fresh.ui.theme = state.ui.theme;
    replaceState(fresh);
    lastProjectPath = null;
    upload.renderAll();
    style.renderStyle();
    switchTab("upload");
    toast("已新建项目");
  });
}

async function openProject() {
  const p = await window.api.openFile([{ name: "漫剧项目", extensions: ["json"] }]);
  if (!p) return;
  const res = await window.api.readJson(p);
  if (!res.ok) {
    toast("打开失败：" + res.error, "err");
    return;
  }
  replaceState(res.data);
  lastProjectPath = p;
  upload.renderAll();
  style.renderStyle();
  switchTab(state.ui.activeTab || "upload");
  toast("项目已打开：" + p.split(/[\\/]/).pop());
}

async function saveProject() {
  if (!lastProjectPath) {
    const p = await window.api.saveJson((state.projectName || "漫剧项目") + ".json");
    if (!p) return;
    lastProjectPath = p;
  }
  const res = await window.api.writeJson(lastProjectPath, state);
  if (res.ok) toast("项目已保存：" + lastProjectPath.split(/[\\/]/).pop());
  else toast("保存失败：" + res.error, "err");
}

async function exportProject() {
  const p = await window.api.saveJson((state.projectName || "漫剧项目") + "_导出.json");
  if (!p) return;
  const res = await window.api.writeJson(p, state);
  if (res.ok) toast("项目已导出");
  else toast("导出失败：" + res.error, "err");
}

// ---------- 右侧面板 ----------
function setRpCollapsed(collapsed) {
  const shell = $(".app-shell");
  shell.classList.toggle("rp-collapsed", collapsed);
  $("#rpOpenTab").hidden = !collapsed;
  $("#rpCollapse").textContent = collapsed ? "«" : "»";
}

function bindRightPanel() {
  $("#rpCollapse").addEventListener("click", () => setRpCollapsed(true));
  $("#rpOpenTab").addEventListener("click", () => setRpCollapsed(false));

  const s = state.settings;
  const fields = {
    providerSel: "provider",
    apiKeyInput: "apiKey",
    baseUrlInput: "baseUrl",
    modelInput: "model",
    maxTokensInput: "maxTokens",
  };
  for (const [id, key] of Object.entries(fields)) {
    $(`#${id}`).value = s[key] ?? "";
  }
  $("#tempRange").value = s.temperature;
  $("#tempVal").textContent = s.temperature;
  $("#providerSel").dispatchEvent(new Event("change"));

  $("#providerSel").addEventListener("change", (e) => {
    const v = e.target.value;
    state.settings.provider = v;
    const presets = {
      deepseek: { url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      doubao: { url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1-6-250615" },
      qwen: { url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
      kimi: { url: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
      glm: { url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus" },
      custom: { url: "", model: "" },
    };
    const p = presets[v];
    if (p) {
      if (!state.settings.baseUrl || Object.values(presets).some((x) => x.url === state.settings.baseUrl)) {
        state.settings.baseUrl = p.url;
        $("#baseUrlInput").value = p.url;
      }
      if (!state.settings.model || state.settings.model === "deepseek-chat") {
        state.settings.model = p.model;
        $("#modelInput").value = p.model;
      }
    }
    saveDraft();
    updateAiStatus();
  });

  $("#apiKeyInput").addEventListener("change", (e) => {
    state.settings.apiKey = e.target.value.trim();
    saveDraft();
    updateAiStatus();
  });
  $("#baseUrlInput").addEventListener("change", (e) => {
    state.settings.baseUrl = e.target.value.trim();
    saveDraft();
  });
  $("#modelInput").addEventListener("change", (e) => {
    state.settings.model = e.target.value.trim();
    saveDraft();
  });
  $("#tempRange").addEventListener("input", (e) => {
    state.settings.temperature = Number(e.target.value);
    $("#tempVal").textContent = state.settings.temperature;
    saveDraft();
  });
  $("#maxTokensInput").addEventListener("change", (e) => {
    state.settings.maxTokens = Math.min(32768, Math.max(256, Number(e.target.value) || 4096));
    e.target.value = state.settings.maxTokens;
    saveDraft();
  });

  $("#btnTestConn").addEventListener("click", async () => {
    const btn = $("#btnTestConn");
    busy(btn, true);
    try {
      const r = await aiCall({ system: "你是测试助手。", user: "请回复：连接正常" });
      toast("连接正常：" + (r || "").slice(0, 40));
    } catch (err) {
      toast("连接失败：" + err.message, "err");
    } finally {
      busy(btn, false);
    }
  });

  // 应用更新
  $("#updateUrlInput").value = state.settings.updateUrl || "";
  $("#updateUrlInput").addEventListener("change", (e) => {
    state.settings.updateUrl = e.target.value.trim();
    saveDraft();
    toast("已保存更新清单地址");
  });
  $("#btnCheckUpdate").addEventListener("click", () => runUpdateCheck(false));
  window.api.onUpdateProgress(({ downloaded, total }) => renderUpdateProgress(downloaded, total));

}

function updateStatus(msg) {
  const el = $("#updateStatus");
  if (el) el.textContent = msg;
}

function renderUpdateProgress(downloaded, total) {
  const wrap = $("#updateBarWrap");
  const bar = $("#updateBar");
  if (wrap) wrap.style.display = "block";
  if (bar) {
    if (total > 0) bar.style.width = Math.min(100, (downloaded / total) * 100) + "%";
    else bar.style.width = "70%";
  }
  const mb = (downloaded / 1024 / 1024).toFixed(1);
  if (total > 0) updateStatus(`正在下载新版本… ${mb} MB / ${(total / 1024 / 1024).toFixed(1)} MB`);
  else updateStatus(`正在下载新版本… 已下载 ${mb} MB`);
}

async function runUpdateCheck(auto) {
  const url = state.settings.updateUrl;
  if (!url) {
    updateStatus("未配置更新清单地址，请在下方填写");
    return;
  }
  const btn = $("#btnCheckUpdate");
  busy(btn, true);
  updateStatus("正在检查更新…");
  try {
    const r = await window.api.checkUpdate(url);
    if (!r.ok) {
      updateStatus("检查失败：" + r.error);
      return;
    }
    if (!r.hasUpdate) {
      updateStatus(`当前已是 v${r.current}（最新）`);
      if (auto) toast("已是最新版本");
      return;
    }
    updateStatus(`发现新版本 v${r.latest}（当前 v${r.current}）`);
    toast(`发现新版本 v${r.latest}`, "ok");
    const dlUrl = r.url || url;
    $("#updateBarWrap").style.display = "block";
    $("#updateBar").style.width = "0%";
    updateStatus("正在下载新版本…");
    const dump = await window.api.downloadUpdate(dlUrl, r.latest);
    $("#updateBarWrap").style.display = "none";
    $("#updateBar").style.width = "0%";
    if (dump.ok) {
      updateStatus(`新版本已下载并解压到：${dump.folder}\n已为你打开该文件夹，请运行其中的 AI漫剧工作站.exe`);
      toast("新版本已下载，已打开文件夹");
    } else {
      updateStatus("下载失败：" + dump.error);
      toast("下载失败：" + dump.error, "err");
    }
  } catch (err) {
    updateStatus("更新出错：" + (err.message || err));
  } finally {
    busy(btn, false);
  }
}

function updateAiStatus() {
  const dot = $("#aiStatusDot");
  if (state.settings.apiKey && state.settings.baseUrl && state.settings.model) {
    dot.className = "mini-dot ok";
    dot.title = "已配置";
  } else {
    dot.className = "mini-dot";
    dot.title = "未配置完整";
  }
}

// ---------- 事件绑定 ----------
function bindTitlebar() {
  $("#winMin").addEventListener("click", () => window.api.minimize());
  $("#winMax").addEventListener("click", async () => {
    const st = await window.api.maximize();
    $("#winMax").innerHTML = st === "max" ? "&#x25A3;" : "&#x25A1;";
  });
  $("#winClose").addEventListener("click", () => window.api.close());
  window.api.onWinState((st) => {
    $("#winMax").innerHTML = st === "max" ? "&#x25A3;" : "&#x25A1;";
  });
}

function bindTabs() {
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function bindNav() {
  $$(".nav-group-head").forEach((head) => {
    head.addEventListener("click", () => {
      head.parentElement.classList.toggle("closed");
    });
  });

  $$(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const action = item.dataset.action;
      const tab = item.dataset.tab;
      if (tab) {
        switchTab(tab);
        return;
      }
      if (action === "new") newProject();
      if (action === "open") openProject();
      if (action === "save") saveProject();
      if (action === "export") exportProject();
      if (action === "goto-cat") {
        switchTab("prompts");
        prompts.setPromptCategory(item.dataset.cat);
      }
      if (action === "goto-sb-list") switchTab("storyboard");
      if (action === "open-settings") {
        setRpCollapsed(false);
        const card = $("#rightPanel .card.mini");
        card?.scrollIntoView({ behavior: "smooth", block: "start" });
        card?.animate([{ boxShadow: "0 0 0 4px var(--purple-soft)" }, { boxShadow: "none" }], {
          duration: 900,
        });
      }
      if (action === "open-rules") {
        switchTab("storyboard");
        const body = $("#ruleBody");
        if (body.classList.contains("closed")) {
          body.classList.remove("closed");
          $("#ruleArrow").textContent = "▾";
        }
        $("#ruleBody").scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });
}

function bindGlobal() {
  $("#themeToggle").addEventListener("click", toggleTheme);

  $("#modalMask").addEventListener("click", (e) => {
    if (e.target === $("#modalMask")) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (e.shiftKey) exportProject();
      else saveProject();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      openProject();
    }
    if (e.key === "Escape") closeModal();
  });

  // 生成过程中允许 ESC 取消
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isRunning()) {
      cancelLLM();
      toast("已发送取消请求", "err");
    }
  });
}

// ---------- 初始化 ----------
async function init() {
  restoreDraft();

  // 先绑定核心交互，保证界面立刻可用，避免异步初始化异常导致“卡死”
  applyTheme();
  bindTitlebar();
  bindTabs();
  bindNav();
  bindGlobal();
  bindRightPanel();

  upload.initUpload();
  style.initStyle();
  assets.initAssets();
  prompts.initPrompts();
  storyboard.initStoryboard();
  calendar.initCalendar();
  pet.petInit();

  // 再异步补齐默认提示词与版本号（失败也不影响使用）
  try {
    const defaults = await window.api.getDefaults();
    if (defaults) {
      const s = state.settings;
      if (!s.splitPrompt) s.splitPrompt = defaults.splitPrompt;
      if (!s.assetStylePrompt) s.assetStylePrompt = defaults.assetStylePrompt;
      if (!s.storyboardRule) s.storyboardRule = defaults.storyboardRule;
      if (!s.storyboardExample) s.storyboardExample = defaults.storyboardExample;
      if (!state.storyboard.ruleText) state.storyboard.ruleText = defaults.storyboardRule;
      if (!s.assetPromptRule) {
        s.assetPromptRule =
          "1. 人物、场景、道具三类内容完全隔离。\n2. 人物区分单人与群像，单人突出唯一主体，群像写清人数站位与普通大众面容。\n3. 结合该资产参考词与全局配置前缀词。\n4. 提示词符合剧本背景，专业明确。\n5. 只输出提示词正文。";
      }
      storyboard.renderRuleText();
    }
    const ver = await window.api.getVersion();
    $("#versionTag").textContent = "v" + ver;
  } catch (err) {
    console.error("init defaults failed", err);
  }

  // 自测暴露
  window.__selftest_parse = (t) => parseEpisodes(t).length;
  window.__selftest_ai = (payload) =>
    aiCall({
      system: payload.system,
      user: payload.user,
      label: "selftest",
    });

  upload.renderAll();
  style.renderStyle();
  switchTab(state.ui.activeTab || "upload");
  updateNav();
  window.__initDone = true;

  // 启动后自动检查更新（仅当已配置更新地址）
  if (state.settings.updateUrl) {
    setTimeout(() => runUpdateCheck(true), 3000);
  }

  // 关闭/切走立即保存 + 每 25 秒自动保存一次，避免重开又要重新上传/拆分
  window.addEventListener("beforeunload", () => saveDraft());
  window.addEventListener("pagehide", () => saveDraft());
  setInterval(() => saveDraft(), 25000);
}

// 全局错误兜底：任何未捕获错误都提示用户并写入日志，避免看起来“卡死”
window.addEventListener("error", (e) => {
  console.error("global error", e.message);
  toast("出现异常：" + (e.message || "未知错误"), "err", 5000);
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = (e.reason && (e.reason.message || String(e.reason))) || "未处理的异步错误";
  console.error("unhandled rejection", msg);
  toast("出现异常：" + msg, "err", 5000);
});

init();
