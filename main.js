const { app, BrowserWindow, ipcMain, dialog, shell, net } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, execSync } = require("child_process");
const iconv = require("iconv-lite");
const JSZip = require("jszip");

const IS_SELFTEST = process.argv.includes("--selftest");
let mainWindow = null;
const llmAborts = new Set();

// 稳健性：2D 卡通界面几乎全是 DOM/文本，禁用 GPU 硬件加速可避免部分显卡驱动导致的
// 白屏、窗口未响应或“卡在首屏”的问题。
app.disableHardwareAcceleration();

// 单实例：避免重复双击出现多个窗口造成“打不开/卡住”的错觉。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function logToFile(message) {
  try {
    const p = path.join(__dirname, "work", "app.log");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    frame: false,
    icon: path.join(__dirname, "renderer", "assets", "icon.ico"),
    backgroundColor: "#FBF7EF",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logToFile(`did-fail-load code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    logToFile(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on("unresponsive", () => {
    logToFile("renderer unresponsive");
  });

  mainWindow.on("maximize", () => mainWindow.webContents.send("win:state", "max"));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("win:state", "normal"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (IS_SELFTEST) {
    await require("electron").session.defaultSession.clearStorageData();
  }
  createWindow();
  if (IS_SELFTEST) {
    setTimeout(runSelfTest, 2500);
  }
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// 文件解析
// ---------------------------------------------------------------------------
function decodeBuffer(buf) {
  // 优先 UTF-8：若解码后出现大量替换符，则尝试 GBK
  let text = iconv.decode(buf, "utf8");
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 0 && bad / Math.max(text.length, 1) > 0.01) {
    text = iconv.decode(buf, "gbk");
  }
  return text.replace(/^\uFEFF/, "");
}

async function readTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".docx") {
    const buf = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml").async("string");
    // 简单提取：段落换行、制表符分隔
    let out = xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
    out = out
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n");
    return { text: out, kind: "docx" };
  }
  const buf = fs.readFileSync(filePath);
  return { text: decodeBuffer(buf), kind: "txt" };
}

// ---------------------------------------------------------------------------
// AI 大模型调用（OpenAI 兼容，支持流式）
// ---------------------------------------------------------------------------
async function callLLM({ settings, messages, onChunk }) {
  const baseUrl = String(settings.baseUrl || "").replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  llmAborts.add(controller);

  const body = {
    model: settings.model,
    messages,
    temperature: Number(settings.temperature ?? 0.9),
    max_tokens: Math.min(Math.max(Number(settings.maxTokens) || 4096, 256), 32768),
    stream: true,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  if (!resp.ok) {
    let detail = "";
    try {
      detail = await resp.text();
    } catch {}
    const err = new Error(`HTTP ${resp.status}`);
    err.detail = detail.slice(0, 800);
    throw err;
  }

  // 请求结束（含异常）后释放
  try {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            onChunk && onChunk(delta);
          }
        } catch {}
      }
    }
    return full;
  } finally {
    llmAborts.delete(controller);
  }
}

// ---------------------------------------------------------------------------
// 示例文件默认内容
// ---------------------------------------------------------------------------
function sampleText(name) {
  const p = path.join(__dirname, "samples", name);
  try {
    return fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

function defaults() {
  return {
    splitPrompt: sampleText("资产拆分提示词配置要求.txt") || sampleText("剧本资产拆分规则.txt"),
    assetStylePrompt: sampleText("资产提示词参考.txt"),
    storyboardRule: sampleText("分镜优化师规则.txt"),
    storyboardExample: sampleText("分镜示例参考.txt"),
  };
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle("win:minimize", () => mainWindow?.minimize());
ipcMain.handle("win:maximize", () => {
  if (!mainWindow) return "normal";
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized() ? "max" : "normal";
});
ipcMain.handle("win:close", () => mainWindow?.close());

ipcMain.handle("app:defaults", () => defaults());
ipcMain.handle("app:version", () => app.getVersion());

ipcMain.handle("dialog:openFile", async (_e, filters) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "选择文件",
    properties: ["openFile"],
    filters: filters || [
      { name: "剧本文件", extensions: ["txt", "docx"] },
      { name: "文本", extensions: ["txt"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("dialog:saveJson", async (_e, defaultName) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: "保存项目",
    defaultPath: defaultName || "漫剧项目.json",
    filters: [{ name: "漫剧项目", extensions: ["json"] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle("dialog:saveText", async (_e, defaultName) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: "导出文本",
    defaultPath: defaultName || "导出.txt",
    filters: [{ name: "文本", extensions: ["txt"] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle("file:readScript", async (_e, filePath) => {
  try {
    const r = await readTextFile(filePath);
    return { ok: true, ...r, name: path.basename(filePath), path: filePath };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle("file:readText", async (_e, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return { ok: true, text: decodeBuffer(buf), name: path.basename(filePath) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle("file:writeText", async (_e, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle("file:writeJson", async (_e, filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle("file:readJson", async (_e, filePath) => {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle("file:readSample", (_e, name) => {
  const allow = new Set([
    "剧本资产拆分规则.txt",
    "资产拆分提示词配置要求.txt",
    "资产提示词参考.txt",
    "分镜优化师规则.txt",
    "分镜示例参考.txt",
    "示例剧本.txt",
  ]);
  if (!allow.has(name)) return { ok: false, error: "不允许读取该示例文件" };
  return { ok: true, text: sampleText(name) };
});

ipcMain.handle("llm:chat", async (_e, { settings, messages }) => {
  const wc = mainWindow?.webContents;
  try {
    const full = await callLLM({
      settings,
      messages,
      onChunk: (delta) => wc?.send("llm:chunk", delta),
    });
    return { ok: true, text: full };
  } catch (err) {
    if (err.name === "AbortError") return { ok: false, aborted: true };
    return {
      ok: false,
      error: String(err.message || err),
      detail: err.detail || "",
    };
  }
});

ipcMain.handle("llm:cancel", () => {
  for (const c of llmAborts) {
    try {
      c.abort();
    } catch {}
  }
  return true;
});

ipcMain.handle("shell:openPath", async (_e, p) => {
  try {
    await shell.openPath(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// ---------------------------------------------------------------------------
// 应用更新：检查清单 -> 下载并解压到文档目录（自动更新其他电脑同一份）
// ---------------------------------------------------------------------------
function parseVer(v) {
  return String(v || "0").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
}

function isNewer(local, remote) {
  const a = parseVer(local);
  const b = parseVer(remote);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return false;
    if (x < y) return true;
  }
  return false;
}

// 失败时自动切镜像（国内访问 GitHub 域名常被墙，用 ghfast.top / ghproxy 兜底）
async function fetchWithMirror(url, timeout = 20000) {
  const attempts = [url, "https://ghfast.top/" + url, "https://ghproxy.net/" + url];
  let lastErr = "failed";
  for (const a of attempts) {
    try {
      const resp = await net.fetch(a, { signal: AbortSignal.timeout(timeout) });
      if (resp && resp.ok) return resp;
      lastErr = resp ? `HTTP ${resp.status}` : "empty";
      if (resp && (resp.status === 404 || resp.status === 400)) break;
    } catch (e) {
      lastErr = e.message || "error";
    }
  }
  throw new Error(lastErr);
}

ipcMain.handle("update:check", async (_e, url) => {
  try {
    if (!url) return { ok: false, error: "未配置更新清单地址" };
    const resp = await fetchWithMirror(url, 20000);
    const j = await resp.json();
    const latest = String(j.version || "");
    const current = app.getVersion();
    return { ok: true, current, latest, url: j.url || "", hasUpdate: isNewer(current, latest) };
  } catch (err) {
    return { ok: false, error: `网络不可达（${String(err.message || err).slice(0, 80)}）` };
  }
});

ipcMain.handle("update:download", async (_e, dlUrl, latest) => {
  const wc = mainWindow ? mainWindow.webContents : null;
  const sendProgress = (sz, total) => wc && wc.send("update:progress", { downloaded: sz, total });
  const attempts = [dlUrl, "https://ghfast.top/" + dlUrl, "https://ghproxy.net/" + dlUrl];
  const target = path.join(app.getPath("documents"), `AI漫剧工作站_便携版_v${latest}`);
  const top = "AI漫剧工作站_便携版/";
  let lastErr = "failed";
  for (const a of attempts) {
    try {
      const dest = await curlDownload(a, sendProgress);
      sendProgress(fs.statSync(dest).size, fs.statSync(dest).size);
      const buf = fs.readFileSync(dest);
      if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
        fs.unlinkSync(dest);
        lastErr = "下载内容不是有效的安装包，已自动切换镜像";
        continue;
      }
      const zip = await JSZip.loadAsync(buf);
      for (const f of Object.values(zip.files)) {
        if (f.dir) continue;
        let rel = f.name;
        if (rel.startsWith(top)) rel = rel.slice(top.length);
        if (rel.includes("..") || /^[a-zA-Z]:/.test(rel)) continue;
        const out = path.join(target, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, await f.async("nodebuffer"));
      }
      try { fs.unlinkSync(dest); } catch {}
      await shell.openPath(target);
      return { ok: true, folder: target, via: a.includes("ghfast") ? "镜像" : "直连" };
    } catch (err) {
      lastErr = err.message || "error";
    }
  }
  return { ok: false, error: `下载失败：${lastErr}` };
});

// 用 curl（HTTP/1.1）走系统代理下载，规避 Chromium HTTP/2 大文件被断流的问题；流式写文件并回传进度
function getSystemProxyArgs() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; $e=[int](Get-ItemProperty -Path $k -Name ProxyEnable -ErrorAction SilentlyContinue).ProxyEnable; $s=(Get-ItemProperty -Path $k -Name ProxyServer -ErrorAction SilentlyContinue).ProxyServer; Write-Output ($e.ToString()+'|'+$s)"`,
      { encoding: "utf8", timeout: 8000 }
    ).trim();
    const [e, s] = out.split("|");
    if (e === "1" && s) {
      let host = s.trim();
      const m = host.match(/https\s*=\s*([^;]+)/i);
      if (m) host = m[1].trim();
      host = host.replace(/^https?:\/\//i, "");
      const p = host.split(":");
      if (p.length >= 2) return ["--proxy", `http://${p[0]}:${p[1] || "443"}`, "--proxy-insecure"];
    }
  } catch {}
  return [];
}

function curlHeadTotal(url) {
  return new Promise((resolve) => {
    const args = ["-sIL", "--connect-timeout", "20", url, ...getSystemProxyArgs()];
    const h = spawn("curl.exe", args);
    let buf = "";
    h.stdout.on("data", (d) => (buf += d.toString()));
    h.on("close", () => {
      const m = buf.match(/content-length:\s*(\d+)/i);
      resolve(m ? Number(m[1]) : 0);
    });
    h.on("error", () => resolve(0));
  });
}

function curlDownload(url, onProgress) {
  return new Promise((resolve, reject) => {
    const dest = path.join(app.getPath("temp"), `aigc_update_${Date.now()}.zip`);
    curlHeadTotal(url).then((total) => {
      const args = ["-L", "--fail", "--connect-timeout", "20", "--max-time", "900", "-o", dest, url, ...getSystemProxyArgs()];
      const h = spawn("curl.exe", args);
      let errored = false;
      const iv = setInterval(() => {
        try {
          const sz = fs.statSync(dest).size;
          onProgress(sz, total);
        } catch {}
      }, 350);
      h.on("error", (e) => { errored = true; clearInterval(iv); reject(e); });
      h.on("close", (code) => {
        clearInterval(iv);
        if (errored) return;
        if (code !== 0) {
          try { fs.unlinkSync(dest); } catch {}
          reject(new Error(`curl 退出码 ${code}`));
          return;
        }
        resolve(dest);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 自测
// ---------------------------------------------------------------------------
async function runSelfTest() {
  const results = [];
  const consoleErrors = [];
  const check = (name, ok, extra = "") => {
    results.push({ name, ok: !!ok, extra });
    console.log(`${ok ? "PASS" : "FAIL"} - ${name}${extra ? " :: " + extra : ""}`);
  };
  try {
    const wc = mainWindow.webContents;
    wc.on("console-message", (_e, level, message) => {
      if (level >= 2) consoleErrors.push(message);
    });
    // 本地模拟 AI 服务（SSE 流式）
    const mockServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunks = ["你", "好", "，", "世界"];
      let i = 0;
      const iv = setInterval(() => {
        if (i < chunks.length) {
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`
          );
        } else {
          res.write("data: [DONE]\n\n");
          clearInterval(iv);
          res.end();
        }
      }, 12);
    });
    await new Promise((r) => mockServer.listen(0, "127.0.0.1", r));
    const mockPort = mockServer.address().port;
    const r = await wc.executeJavaScript(`(async () => {
      const out = { checks: [] };
      const c = (name, ok, extra) => out.checks.push({ name, ok, extra });
      const wait = ms => new Promise(r => setTimeout(r, ms));
      c("window.api 已注入", !!window.api && typeof window.api.llmChat === 'function');
      c("五栏 Tab 存在", document.querySelectorAll('.tab-btn').length === 5);
      c("左侧导航存在", !!document.querySelector('.nav-tree'));
      c("右侧面板存在", !!document.querySelector('.right-panel'));
      c("主题切换按钮存在", !!document.querySelector('#themeToggle'));
      c("三栏布局", !!document.querySelector('.app-shell') && getComputedStyle(document.querySelector('.app-shell')).display === 'grid');
      c("弹窗遮罩默认隐藏", getComputedStyle(document.querySelector('#modalMask')).display === 'none');
      c("分镜头默认隐藏", getComputedStyle(document.querySelector('#sbEpisodeHead')).display === 'none');
      c("解析剧本", window.__selftest_parse ? window.__selftest_parse('第1集\\n1-1日 外 王府\\n△字幕：测试。\\n第2集\\n2-1夜 内 茅屋\\n△某人进屋。') === 2 : true);
      c("切换Tab", (() => { const b = document.querySelectorAll('.tab-btn')[2]; b && b.click(); return document.querySelector('.tab-panel.active') && document.querySelector('.tab-panel.active').dataset.tab === 'assets'; })());
      c("切换主题", (() => { const t = document.querySelector('#themeToggle'); if(!t) return false; t.click(); return document.body.classList.contains('dark') || document.body.dataset.theme === 'dark'; })());
      c("应用宠物存在", !!document.querySelector('#petHost .pet'));
      c("AI 设置默认值", document.querySelector('#modelInput').value.length > 0 && document.querySelector('#baseUrlInput').value.includes('http'));
      c("更新检查接口存在", typeof window.api.checkUpdate === 'function' && typeof window.api.downloadUpdate === 'function');
      c("更新检查按钮存在", !!document.querySelector('#btnCheckUpdate'));
      c("模型预设含千问", [...document.querySelectorAll('#providerSel option')].some(o => o.value === 'qwen'));
      c("分镜网格存在", !!document.querySelector('#sbGrid'));
      c("分镜集数折叠按钮存在", !!document.querySelector('#sbEpToggle'));
      c("日历按钮存在", !!document.querySelector('#calBtn'));
      c("资产范围切换存在", document.querySelectorAll('#assetScopeChips .chip').length === 2);
      c("全局前缀词输入存在", !!document.querySelector('#cfgPrefix'));
      c("拆分规则配置存在", !!document.querySelector('#splitRuleText'));
      c("拆分规则保存按钮存在", !!document.querySelector('#btnSaveSplitRule'));
      c("重新拆分按钮存在", !!document.querySelector('#btnResplit'));
      c("提示词规则配置存在", !!document.querySelector('#scoreRuleText'));
      c("提示词规则保存按钮存在", !!document.querySelector('#btnSaveScoreRule'));
      c("分镜规则保存按钮存在", !!document.querySelector('#btnSaveSbRule'));
      c("按集剧本查看存在", !!document.querySelector('#assetScriptBlock'));
      c("剧本预览常显存在", !!document.querySelector('.preview-block'));
      c("选择剧本风格按钮存在", !!document.querySelector('#btnChooseStyle'));
      (() => { document.querySelectorAll('.tab-btn')[4].click(); return true; })();
      c("分镜规则默认文本", document.querySelector('#ruleText').value.length > 100);
      document.querySelector('#btnSample').click();
      await wait(1500);
      c("载入示例剧本", !document.querySelector('#scriptInfoCard').hidden && document.querySelectorAll('#uploadEpisodes .ep-chip').length >= 2);
      c("剧本信息集数", parseInt(document.querySelector('#infoEpisodes').textContent, 10) >= 2);
      document.querySelectorAll('.tab-btn')[1].click();
      await wait(150);
      document.querySelector('#styleAi3d').click();
      await wait(150);
      c("选择风格", document.querySelector('#styleAi3d').classList.contains('selected'));
      document.querySelector('#rpCollapse').click();
      await wait(150);
      c("右侧面板收起", document.querySelector('.app-shell').classList.contains('rp-collapsed'));
      document.querySelector('#rpOpenTab').click();
      await wait(150);
      c("右侧面板展开", !document.querySelector('.app-shell').classList.contains('rp-collapsed'));
      document.querySelectorAll('.tab-btn')[2].click();
      await wait(150);
      c("资产四板块标签", document.querySelectorAll('#assetCatTabs .atab').length === 4);
      c("资产单列表存在", !!document.querySelector('#list-asset'));
      c("集数折叠按钮存在", !!document.querySelector('#assetEpToggle'));
      c("资产搜索框存在", !!document.querySelector('#assetSearch'));
      c("停止拆分按钮存在", !!document.querySelector('#btnStopSplit'));
      c("标注主要角色按钮存在", !!document.querySelector('#btnAnnotate'));
      c("进度条存在", !!document.querySelector('#splitBar') && !!document.querySelector('#splitPercent'));
      await wait(500);
      const pe = document.querySelector('#petImg');
      c("宠物图片加载", !!pe && pe.complete && pe.naturalWidth > 0, (pe && pe.src ? pe.src.split('/').pop() : ''));
      document.querySelector('#apiKeyInput').value = 'test-key';
      document.querySelector('#apiKeyInput').dispatchEvent(new Event('change'));
      document.querySelector('#baseUrlInput').value = 'http://127.0.0.1:${mockPort}/v1';
      document.querySelector('#baseUrlInput').dispatchEvent(new Event('change'));
      document.querySelector('#modelInput').value = 'mock-model';
      document.querySelector('#modelInput').dispatchEvent(new Event('change'));
      let llmText = '';
      try {
        llmText = await window.__selftest_ai({ system: 'ping', user: 'hi' });
      } catch (err) {
        llmText = 'ERR:' + err.message;
      }
      c("AI 流式调用全链路", llmText === '你好，世界', llmText);
      localStorage.removeItem('aiws_project_draft_v1');
      return out;
    })()`, true);
    for (const item of r.checks) check(item.name, item.ok, item.extra);
    if (consoleErrors.length) {
      check("渲染进程无控制台错误", false, consoleErrors.slice(0, 3).join(" | "));
    } else {
      check("渲染进程无控制台错误", true);
    }
  } catch (err) {
    check("自测脚本执行", false, String(err.message || err));
  }
  try {
    await new Promise((r) => mockServer.close(r));
  } catch {}
  // 界面截图（供 OCR 可见性检查）
  try {
    const shotDir = path.join(__dirname, "work");
    fs.mkdirSync(shotDir, { recursive: true });
    const img = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, "ui_check.png"), img.toPNG());
    const metrics = await mainWindow.webContents.executeJavaScript(`(() => {
      const rect = (s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), color: cs.color, bg: cs.backgroundColor, display: cs.display };
      };
      return {
        shell: rect('.app-shell'),
        left: rect('.left-panel'),
        tabs: rect('.tabs'),
        tabBtn: rect('.tab-btn'),
        card: rect('.card'),
        right: rect('.right-panel'),
        navBrand: rect('.nav-brand'),
        dropzone: rect('.dropzone'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        decoCount: document.querySelectorAll('.deco').length,
        visibleCards: [...document.querySelectorAll('.card')].filter(c => c.getBoundingClientRect().width > 50).length,
        activeTab: document.querySelector('.tab-panel.active')?.dataset.tab,
      };
    })()`);
    fs.writeFileSync(path.join(shotDir, "metrics.json"), JSON.stringify(metrics, null, 2));
    await mainWindow.webContents.executeJavaScript(`document.querySelector('#themeToggle').click()`);
    await new Promise((r) => setTimeout(r, 350));
    const img2 = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, "ui_dark.png"), img2.toPNG());
  } catch (err) {
    check("界面截图", false, String(err.message || err));
  }
  const failed = results.filter((x) => !x.ok).length;
  console.log(`SELFTEST_RESULT ${failed === 0 ? "PASS" : "FAIL"} total=${results.length} failed=${failed}`);
  app.exit(failed === 0 ? 0 : 1);
}

process.on("uncaughtException", (err) => {
  console.error("uncaught:", err);
  if (IS_SELFTEST) {
    console.log("SELFTEST_RESULT FAIL uncaught=" + err.message);
    app.exit(1);
  }
});
