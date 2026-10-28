const { contextBridge, ipcRenderer } = require("electron");
const { webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file && file.path ? file.path : "";
    }
  },
  minimize: () => ipcRenderer.invoke("win:minimize"),
  maximize: () => ipcRenderer.invoke("win:maximize"),
  close: () => ipcRenderer.invoke("win:close"),
  onWinState: (cb) =>
    ipcRenderer.on("win:state", (_e, state) => cb(state)),

  getDefaults: () => ipcRenderer.invoke("app:defaults"),
  getVersion: () => ipcRenderer.invoke("app:version"),

  openFile: (filters) => ipcRenderer.invoke("dialog:openFile", filters),
  saveJson: (name) => ipcRenderer.invoke("dialog:saveJson", name),
  saveText: (name) => ipcRenderer.invoke("dialog:saveText", name),

  readScript: (p) => ipcRenderer.invoke("file:readScript", p),
  readText: (p) => ipcRenderer.invoke("file:readText", p),
  readSample: (name) => ipcRenderer.invoke("file:readSample", name),
  writeText: (p, c) => ipcRenderer.invoke("file:writeText", p, c),
  writeJson: (p, d) => ipcRenderer.invoke("file:writeJson", p, d),
  readJson: (p) => ipcRenderer.invoke("file:readJson", p),
  openPath: (p) => ipcRenderer.invoke("shell:openPath", p),

  llmChat: (payload) => ipcRenderer.invoke("llm:chat", payload),
  llmCancel: () => ipcRenderer.invoke("llm:cancel"),
  onLlmChunk: (cb) => ipcRenderer.on("llm:chunk", (_e, delta) => cb(delta)),

  checkUpdate: (url) => ipcRenderer.invoke("update:check", url),
  downloadUpdate: (url, latest) => ipcRenderer.invoke("update:download", url, latest),
  onUpdateProgress: (cb) => ipcRenderer.on("update:progress", (_e, d) => cb(d)),
});
