// ============================================================
// 全局状态与持久化
// 资产为全局合并列表（跨集去重），每项记录出现集数与参考词
// ============================================================

const DRAFT_KEY = "aiws_project_draft_v2";

export const ASSET_CATS = [
  { key: "single", label: "单人", icon: "👤" },
  { key: "group", label: "群像", icon: "👥" },
  { key: "scene", label: "场景", icon: "🏞️" },
  { key: "prop", label: "道具", icon: "⚔️" },
];

function emptyAssets() {
  return { single: [], group: [], scene: [], prop: [] };
}

export const DEFAULT_STATE = {
  version: 3,
  projectName: "未命名项目",
  genType: "", // 'ai3d' | 'aiReal'
  script: { filename: "", text: "", episodes: [] },
  assets: emptyAssets(),
  prompts: emptyAssets(),
  storyboard: { ruleText: "", ruleFile: "", byEpisode: {} },
  calendar: {}, // { [dateISO]: [{id,text,time,done}] }
  settings: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat",
    temperature: 0.9,
    maxTokens: 4096,
    prefixWords: "",
    splitPrompt: "",
    assetStylePrompt: "",
    assetPromptRule: "",
    storyboardRule: "",
    storyboardExample: "",
    updateUrl: "",
  },
  ui: { theme: "light", activeTab: "upload", activeEpisode: 1 },
};

export let state = deepClone(DEFAULT_STATE);

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {}
}

export function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const merged = deepClone(DEFAULT_STATE);
    mergeDeep(merged, JSON.parse(raw));
    state = merged;
    normalizeState(state);
  } catch {}
}

export function replaceState(next) {
  const merged = deepClone(DEFAULT_STATE);
  mergeDeep(merged, next);
  state = merged;
  normalizeState(state);
  saveDraft();
}

function mergeDeep(target, source) {
  if (!source || typeof source !== "object") return;
  for (const key of Object.keys(source)) {
    const v = source[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      mergeDeep(target[key], v);
    } else {
      target[key] = v;
    }
  }
}

function normalizeState(s) {
  // 旧资产：per-episode -> 全局合并
  const legacyAssets = {};
  let hasLegacy = false;
  for (const ep of Object.keys(s.assets || {})) {
    const e = s.assets[ep];
    if (!e) continue;
    const mapped = e.characters || e.scenes || e.props ? mapLegacyEntry(e) : e;
    if (mapped.single || mapped.group || mapped.scene || mapped.prop) {
      legacyAssets[ep] = mapped;
      hasLegacy = true;
    }
  }
  if (hasLegacy) s.assets = mergeEpisodeAssets(legacyAssets);
  if (!s.assets || Array.isArray(s.assets)) s.assets = emptyAssets();

  const legacyPrompts = {};
  let hasLegacyP = false;
  for (const ep of Object.keys(s.prompts || {})) {
    const p = s.prompts[ep];
    if (!p) continue;
    const mapped = p.characters || p.scenes || p.props ? mapLegacyEntry(p) : p;
    if (mapped.single || mapped.group || mapped.scene || mapped.prop) {
      legacyPrompts[ep] = mapped;
      hasLegacyP = true;
    }
  }
  if (hasLegacyP) {
    const out = emptyAssets();
    for (const ep of Object.keys(legacyPrompts)) {
      const e = legacyPrompts[ep];
      for (const cat of ASSET_CATS) {
        for (const it of e[cat.key] || []) {
          if (it && it.name) out[cat.key].push({ id: it.id || uid(), assetId: it.assetId, name: it.name, text: it.text || "" });
        }
      }
    }
    s.prompts = out;
  }
  if (!s.prompts || Array.isArray(s.prompts)) s.prompts = emptyAssets();
  if (!s.calendar || typeof s.calendar !== "object") s.calendar = {};
}

function mergeEpisodeAssets(epMap) {
  const out = emptyAssets();
  for (const ep of Object.keys(epMap)) {
    const entry = epMap[ep];
    if (!entry) continue;
    for (const cat of ASSET_CATS) {
      for (const it of entry[cat.key] || []) {
        if (!it || !it.name) continue;
        mergeAsset(cat, it, Number(ep));
      }
    }
  }
  return out;
}

function mapLegacyEntry(e) {
  const out = { single: [], group: [], scene: [], prop: [] };
  if (Array.isArray(e.characters)) {
    for (const c of e.characters) {
      const isGroup =
        /群像|路人|NPC|群众|多人|众人|百姓/.test(c.level || "") ||
        /群像|群众|百姓|人们|众人/.test(c.name || "");
      (isGroup ? out.group : out.single).push(c);
    }
  }
  if (Array.isArray(e.scenes)) out.scene = e.scenes;
  if (Array.isArray(e.props)) out.prop = e.props;
  return out;
}

export function getEpisodes() {
  return state.script.episodes || [];
}

export function scriptFullText() {
  return (state.script.episodes || []).map((e) => e.raw || "").join("\n");
}

export function baseName(name) {
  return String(name || "").replace(/[（(【\[].*?[）)】\]]/g, "").trim();
}

function stripParens(s) {
  return String(s || "").replace(/[（(【\[].*?[）)】\]]/g, "").trim();
}

// 角色基准名：取“·/、/-”分隔的第一段（去掉服饰变体）
export function baseOf(name) {
  return stripParens(name).split(/[·,，、／/－—]+/)[0].trim();
}

// 服饰/变体：角色名在分隔符之后的部分
export function variantOf(cat, name) {
  if (cat !== "single") return "";
  const parts = stripParens(name).split(/[·,，、／/－—]+/);
  return parts.length > 1 ? parts.slice(1).join("·").trim() : "";
}

// 去重键：单人/群像取命名段首，场景/道具取最后一个位置段并去掉场景修饰
export function dedupeKey(cat, name) {
  let s = stripParens(name);
  if (cat === "scene") return sceneKey(s);
  const parts = s.split(/[·,，、／/－—]+/).map((p) => p.trim()).filter(Boolean);
  if (cat === "single" || cat === "group") s = parts[0] || s;
  else s = parts[parts.length - 1] || s;
  s = s.replace(/\s+/g, "");
  return s.toLowerCase();
}

const TIME_WORDS = ["夜晚", "白天", "夜间", "日间", "凌晨", "清晨", "黄昏", "傍晚", "深夜", "早上", "晚上", "中午", "午后", "夜景", "晨", "暮", "夜", "日", "早", "晚", "午"];

// 场景时间变体（白天 / 夜晚…）
export function sceneTimeVariant(name) {
  const s = stripParens(name).trim();
  const sorted = TIME_WORDS.slice().sort((a, b) => b.length - a.length);
  for (const w of sorted) {
    if (s.startsWith(w)) return w;
  }
  for (const w of sorted) {
    if (s.endsWith(w)) return w;
  }
  return "";
}

// 场景去重键：去掉前后时间前缀/后缀、`的`、常见修饰与分隔符，合并同址
function sceneKey(s) {
  let t = s
    .replace(/[,，、／/－—·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sorted = TIME_WORDS.slice().sort((a, b) => b.length - a.length);
  for (const w of sorted) {
    const pat = new RegExp("^(?:" + w + ")\\s*");
    if (pat.test(t)) t = t.replace(pat, "");
  }
  let prev;
  do {
    prev = t;
    t = t.replace(/(夜晚|夜间|白天|日间|夜景|外景|内景|远景|近景|一角|一边|门口|之外|屋内|室内|室外|晚|晨|内|外|中|里|旁|处|日|夜)$/g, "");
  } while (t !== prev);
  t = t.replace(/\s+/g, "").replace(/的/g, "");
  return t.toLowerCase();
}

export function assetKey(name) {
  return dedupeKey("scene", name);
}

export function countOccurrences(text, needle) {
  if (!needle) return 0;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (String(text || "").match(new RegExp(esc, "g")) || []).length;
}

export function uid() {
  return "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function activeEpisodeNo() {
  const list = getEpisodes();
  if (!list.length) return 1;
  const n = Number(state.ui.activeEpisode);
  return list.some((e) => Number(e.no) === n) ? n : Number(list[0].no);
}

export function assetsOf(cat) {
  return state.assets[cat] || [];
}

export function promptsOf(cat) {
  return state.prompts[cat] || [];
}

export function assetsForEpisode(cat, epNo) {
  return assetsOf(cat).filter((a) => (a.episodes || []).map(Number).includes(Number(epNo)));
}

export function findAssetById(cat, id) {
  return assetsOf(cat).find((a) => a.id === id);
}

export function ensureStoryboard(epNo) {
  if (!state.storyboard.byEpisode[epNo]) state.storyboard.byEpisode[epNo] = [];
  return state.storyboard.byEpisode[epNo];
}

export function resetAssetState() {
  state.assets = emptyAssets();
  state.prompts = emptyAssets();
  saveDraft();
}

const ENV_WORDS = [
  "水", "草丛", "草", "石头", "石子", "树", "树木", "树枝", "泥土", "泥地",
  "灰尘", "尘土", "火焰", "火", "烟雾", "烟", "雾气", "雾", "光", "风", "雨",
  "雪", "云", "天空", "地面", "墙壁", "草地", "河", "海", "溪", "落叶",
  "灌木", "月光", "阳光", "空气", "蒸气", "水汽", "露水", "石阶", "石墙",
];

export function isEnvObject(name) {
  const s = String(name || "").trim();
  if (!s) return false;
  if (ENV_WORDS.includes(s)) return true;
  if (s.length <= 3 && ENV_WORDS.some((w) => w.length <= 3 && s === w)) return true;
  return false;
}

export function mergeAsset(cat, item, epNo) {
  if (!state.assets[cat]) state.assets[cat] = [];
  const list = state.assets[cat];
  const key = item.key || dedupeKey(cat, item.name);
  const base = cat === "single" ? baseOf(item.name) : (cat === "group" ? baseOf(item.name) : stripParens(item.name));
  const variant = cat === "single" ? variantOf(cat, item.name) : "";
  const sceneTime = cat === "scene" ? sceneTimeVariant(item.name) : "";
  const canonical = cat === "scene" ? sceneKey(stripParens(item.name)) : (base || item.name);
  const existing = list.find((a) => a.key === key);
  if (existing) {
    if (!existing.episodes.includes(Number(epNo))) existing.episodes.push(Number(epNo));
    if (!existing.desc && item.desc) existing.desc = item.desc;
    if (variant) {
      if (!existing.costumes) existing.costumes = {};
      existing.costumes[Number(epNo)] = variant;
    }
    if (sceneTime) {
      if (!existing.times) existing.times = {};
      existing.times[Number(epNo)] = sceneTime;
    }
    if (canonical && (item.name.length < existing.name.length || /[（(·,，、\-]/.test(existing.name))) existing.name = canonical;
    return existing;
  }
  const newItem = {
    id: uid(),
    name: canonical,
    key,
    desc: item.desc || "",
    level: item.level || "",
    episodes: [Number(epNo)],
    verified: false,
    words: "",
    ...(variant ? { costumes: { [Number(epNo)]: variant } } : {}),
    ...(sceneTime ? { times: { [Number(epNo)]: sceneTime } } : {}),
  };
  list.push(newItem);
  return newItem;
}
