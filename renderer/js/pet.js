// ============================================================
// 应用宠物：使用提供的素材图片，按时间段/状态切换；全界面走动、可拖动
// 素材目录 renderer/assets/pet/pet-01..12.png（白色贴纸图）
// ============================================================

const IMG_DIR = "assets/pet/";
const IMG = (n) => `${IMG_DIR}pet-${String(n).padStart(2, "0")}.png`;

// 状态覆盖（工作/完成/开心/犯困/点击/走动 对应不同素材）
const STATE_IMG = { work: 6, done: 7, happy: 8, sleepy: 9, click: 10, walk: 11 };
const REMAIN = [5, 6, 7, 8, 9, 10, 11, 12]; // 其余时间轮换用
let startAt = 0;

// 定时小动作（动漫式）：挥手 / 欢呼 / 跳舞 / 犯困 / 眨眼
const EMOTES = [
  { img: 2, cls: "emote-wave", phrases: ["嗨~", "挥挥手~"] },
  { img: 5, cls: "emote-cheer", phrases: ["加油鸭！", "冲鸭~"] },
  { img: 12, cls: "emote-dance", phrases: ["摇一摇~", "好耶~"] },
  { img: 9, cls: "emote-sleep", phrases: ["有点困…", "呼…"] },
  { img: 8, cls: "emote-wink", phrases: ["嘿~", "看我！"] },
];

const PHRASES = [
  "今天也要一起加油鸭！",
  "摸摸我～",
  "进度交给小宠，放心～",
  "要不要喝杯奶茶再继续？",
  "我已经准备好啦！",
  "你认真的样子最帅啦~",
  "喵~ 我在呢！",
];

let host = null, petEl = null, imgEl = null, bubble = null;
let mode = "idle";
let curNum = null;
let x = 400, y = 300, targetX = 400, targetY = 300, speed = 0.25;
let pausedUntil = 0, rafId = null, bubbleTimer = null, moved = false;
let dragging = false, dragOff = { x: 0, y: 0 }, dragStart = { x: 0, y: 0 };
let petW = 120, petH = 120, titleH = 44;
let minX = 8, maxX = 1000, minY = 52, maxY = 700;
let lastDx = 0, lastEmoteAt = 0, emoteActive = false;

function idleImg() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  // 刚打开应用（前约 40 秒）用 01/02 交替
  if (performance.now() - startAt < 40000) {
    return Math.floor((performance.now() - startAt) / 15000) % 2 === 0 ? 1 : 2;
  }
  // 晚上 9 点以后用 03
  if (h >= 21) return 3;
  // 中午 12 点 / 晚上 6:55 准时切到 04
  if (h === 12 && m >= 0 && m < 60) return 4;
  if (h === 18 && m >= 55) return 4;
  // 其余时间在剩余素材间轮换
  const bucket = Math.floor((h * 60 + m) / 40) % REMAIN.length;
  return REMAIN[bucket];
}

function currentNum() {
  if (STATE_IMG[mode]) return STATE_IMG[mode];
  return idleImg();
}

function setImg(n) {
  if (curNum === n) return;
  curNum = n;
  if (imgEl) imgEl.src = IMG(n);
}

function computeBounds() {
  const coll = document.querySelector(".app-shell")?.classList.contains("rp-collapsed");
  const rightW = coll ? 0 : (document.querySelector(".right-panel")?.offsetWidth || 348);
  minX = 8;
  maxX = Math.max(minX + petW, window.innerWidth - Math.max(rightW, 8) - petW - 8);
  minY = titleH + 8;
  maxY = Math.max(minY + petH, window.innerHeight - petH - 8);
}

function clamp() {
  x = Math.min(maxX, Math.max(minX, x));
  y = Math.min(maxY, Math.max(minY, y));
}

function pickTarget() {
  // 只在窗口四条边上选点，不在中心移动
  const edge = Math.floor(Math.random() * 4);
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  if (edge === 0) {
    targetX = Math.round(Math.random() * rangeX + minX);
    targetY = minY;
  } else if (edge === 1) {
    targetX = Math.round(Math.random() * rangeX + minX);
    targetY = maxY;
  } else if (edge === 2) {
    targetX = minX;
    targetY = Math.round(Math.random() * rangeY + minY);
  } else {
    targetX = maxX;
    targetY = Math.round(Math.random() * rangeY + minY);
  }
}

function renderPos() {
  if (petEl) petEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function petInit() {
  host = document.getElementById("petHost");
  if (!host) return;
  startAt = performance.now();
  host.innerHTML = `<div class="pet" id="pet"><div class="pet-sprite" id="petSprite"><img class="pet-img" id="petImg" alt="应用宠物" draggable="false" /></div><div class="pet-bubble" id="petBubble"></div></div>`;
  petEl = document.getElementById("pet");
  imgEl = document.getElementById("petImg");
  bubble = document.getElementById("petBubble");
  lastEmoteAt = performance.now();
  setImg(idleImg());

  computeBounds();
  window.addEventListener("resize", computeBounds);
  // 初始也放在窗口四边之一
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) { x = Math.random() * (maxX - minX) + minX; y = minY; }
  else if (edge === 1) { x = Math.random() * (maxX - minX) + minX; y = maxY; }
  else if (edge === 2) { x = minX; y = Math.random() * (maxY - minY) + minY; }
  else { x = maxX; y = Math.random() * (maxY - minY) + minY; }
  targetX = x;
  targetY = y;
  pickTarget();

  petEl.addEventListener("pointerdown", (e) => {
    dragging = true;
    petEl.classList.add("dragging");
    const rect = petEl.getBoundingClientRect();
    dragOff.x = e.clientX - rect.left;
    dragOff.y = e.clientY - rect.top;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    moved = false;
    petEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  petEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    x = e.clientX - dragOff.x;
    y = e.clientY - dragOff.y;
    clamp();
    renderPos();
    if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 6) moved = true;
  });
  petEl.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    petEl.classList.remove("dragging");
    petEl.releasePointerCapture?.(e.pointerId);
    if (!moved) {
      petSetMode("click");
      petSay(PHRASES[Math.floor(Math.random() * PHRASES.length)]);
      setTimeout(() => { if (mode === "click") petSetMode("idle"); }, 1500);
    }
    moved = false;
    pausedUntil = performance.now() + 900;
  });

  rafId = requestAnimationFrame(loop);
}

function rightSafe() {
  const coll = document.querySelector(".app-shell")?.classList.contains("rp-collapsed");
  return coll ? 0 : (document.querySelector(".right-panel")?.offsetWidth || 348);
}

function loop() {
  if (!petEl) return;
  const now = performance.now();
  let moving = false;
  if (!dragging && now > pausedUntil) {
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) {
      pausedUntil = now + 800 + Math.random() * 1400;
      pickTarget();
    } else {
      x += (dx / dist) * speed;
      y += (dy / dist) * speed;
      moving = true;
      // 左右翻转
      if (Math.abs(dx) > 2 && imgEl) imgEl.style.transform = `scaleX(${dx > 0 ? 1 : -1})`;
      // 转向瞬间做一个小动画
      if (Math.sign(dx) !== 0 && Math.sign(dx) !== lastDx && Math.abs(dx) > 4) {
        petEl.classList.add("turn");
        setTimeout(() => petEl.classList.remove("turn"), 420);
      }
      lastDx = Math.sign(dx) || lastDx;
    }
  } else if (mode === "idle") {
    setImg(idleImg());
    imgEl.style.transform = "scaleX(1)";
    // 定时触发小动作
    if (!dragging && !emoteActive && now - lastEmoteAt > 22000 + Math.random() * 18000) {
      playEmote();
    }
  }
  petEl.classList.toggle("running", moving);
  renderPos();
  rafId = requestAnimationFrame(loop);
}

function playEmote() {
  const e = EMOTES[Math.floor(Math.random() * EMOTES.length)];
  emoteActive = true;
  petEl.classList.add("emote", e.cls);
  setImg(e.img);
  petSay(e.phrases[Math.floor(Math.random() * e.phrases.length)], 2400);
  setTimeout(() => {
    petEl.classList.remove("emote", e.cls);
    emoteActive = false;
    lastEmoteAt = performance.now();
    if (mode === "idle") setImg(idleImg());
  }, 2000);
}

export function petSetMode(m) {
  mode = m;
  if (!petEl || !imgEl) return;
  petEl.classList.remove("mode-idle", "mode-happy", "mode-work", "mode-done", "mode-click", "mode-sleepy", "emote", "emote-wave", "emote-cheer", "emote-dance", "emote-sleep", "emote-wink");
  petEl.classList.add("mode-" + m);
  emoteActive = false;
  setImg(currentNum());
  imgEl.style.transform = "scaleX(1)";
}

export function petSay(text, ms = 3000) {
  if (!bubble) return;
  bubble.textContent = text;
  bubble.classList.add("show");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove("show"), ms);
}

export function petWorking() {
  petSetMode("work");
  petSay("我在努力工作中…");
}

export function petDone(text) {
  petSetMode("done");
  petSay(text || "完成啦！🎉");
  setTimeout(() => { if (mode === "done") petSetMode("idle"); }, 3600);
}

export function petIdle() {
  petSetMode("idle");
}

export function petRemind(text) {
  petSetMode("happy");
  petSay(text, 5400);
  setTimeout(() => { if (mode === "happy") petSetMode("idle"); }, 5600);
}

export function petStop() {
  if (rafId) cancelAnimationFrame(rafId);
}
