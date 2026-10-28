// ============================================================
// 剧本解析：按「第X集」拆分，识别场次标题
// ============================================================

const CN_NUM = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  十: 10, 百: 100, 零: 0, 两: 2,
};

function cnToNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let total = 0;
  let num = 0;
  for (const ch of s) {
    if (ch === "十") {
      num = num === 0 ? 1 : num;
      total += num * 10;
      num = 0;
    } else if (ch === "百") {
      num = num === 0 ? 1 : num;
      total += num * 100;
      num = 0;
    } else if (CN_NUM[ch] !== undefined) {
      num = CN_NUM[ch];
    }
  }
  total += num;
  return total || 1;
}

export function parseEpisodes(text) {
  const norm = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = norm.split("\n");
  const epRe = /^\s*第\s*(\d+|[一二三四五六七八九十百零两]+)\s*集(.*)$/;
  const episodes = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(epRe);
    if (m) {
      current = {
        no: cnToNum(m[1]),
        title: line.trim(),
        raw: "",
        scenes: [],
      };
      episodes.push(current);
    } else if (current) {
      current.raw += line + "\n";
    }
  }

  if (!episodes.length && norm.trim()) {
    episodes.push({
      no: 1,
      title: "全剧",
      raw: norm,
      scenes: [],
    });
  }

  for (const ep of episodes) {
    ep.raw = ep.raw.trim();
    ep.scenes = parseScenes(ep.raw);
  }
  return episodes;
}

export function parseScenes(text) {
  const lines = String(text || "").split("\n");
  const sceneRe = /^(\d+\s*[-－—]\s*\d+)\s*(.*)$/;
  const scenes = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(sceneRe);
    if (m && m[1].length < 14) {
      cur = { header: line.trim(), text: "" };
      scenes.push(cur);
    } else if (cur) {
      cur.text += line + "\n";
    }
  }
  for (const s of scenes) s.text = s.text.trim();
  return scenes;
}

export function countTextChars(text) {
  return String(text || "").replace(/\s/g, "").length;
}
