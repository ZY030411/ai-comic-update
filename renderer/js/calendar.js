// ============================================================
// 右下角日历：按天添加自定义工作内容，到期由宠物提醒
// ============================================================

import { state, saveDraft, uid } from "./state.js";
import { $, toast, esc } from "./ui.js";
import { petRemind } from "./pet.js";

let host = null;
let viewY = null; // 当前显示的年月
let viewM = null; // 0-11
let selDay = null; // 'YYYY-MM-DD' 或 null(月份视图)
let editingId = null;
const reminded = new Set();

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function iso(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function todayISO() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtDisplay(isoStr) {
  const [y, m, d] = isoStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export function initCalendar() {
  host = document.getElementById("calendarHost");
  if (!host) return;
  host.innerHTML = `
    <button class="cal-btn" id="calBtn" title="日历 / 工作安排"><span>📅</span><span class="cal-dot" id="calDot"></span></button>
    <div class="cal-panel" id="calPanel" hidden></div>`;
  const now = new Date();
  viewY = now.getFullYear();
  viewM = now.getMonth();
  $("#calBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  $("#calPanel").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => {
    const panel = $("#calPanel");
    if (panel && !panel.hidden) panel.hidden = true;
  });
  renderCalPanel();
  refreshDot();
  tickReminders();
  setInterval(tickReminders, 20000);
}

function toggle() {
  const panel = $("#calPanel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderCalPanel();
}

function refreshDot() {
  const dot = $("#calDot");
  const n = (state.calendar[todayISO()] || []).filter((x) => !x.done).length;
  if (dot) {
    dot.style.display = n ? "grid" : "none";
    dot.textContent = n;
  }
}

function itemsOf(day) {
  return state.calendar[day] || [];
}

function saveItems(day, arr) {
  if (arr.length) state.calendar[day] = arr;
  else delete state.calendar[day];
  saveDraft();
}

function renderCalPanel() {
  const panel = $("#calPanel");
  if (!panel) return;
  panel.innerHTML = "";

  if (selDay) {
    // 单日编辑
    const list = itemsOf(selDay);
    panel.innerHTML = `
      <div class="cal-head"><button class="cal-nav" id="calBack">‹</button>
        <div class="cal-title">${fmtDisplay(selDay)}<span class="cal-count">${list.filter((x) => !x.done).length} 项待办</span></div>
        <button class="cal-nav" id="calClose">✕</button></div>
      <div class="cal-tasks" id="calTasks"></div>
      <div class="cal-addrow">
        <input class="cal-addinput" id="calNewText" placeholder="写点今天要做的事…" />
        <input class="cal-addtime" id="calNewTime" type="time" title="提醒时间(可选)" />
        <button class="cal-add" id="calAdd">＋</button>
      </div>`;
    renderTasks();
    $("#calBack").addEventListener("click", () => { selDay = null; renderCalPanel(); });
    $("#calClose").addEventListener("click", () => { selDay = null; renderCalPanel(); toggle(); });
    $("#calAdd").addEventListener("click", () => addTask());
    $("#calNewText").addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });
    return;
  }

  const first = new Date(viewY, viewM, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = iso(viewY, viewM, d);
    const list = itemsOf(day);
    const undone = list.filter((x) => !x.done).length;
    const isToday = day === todayISO();
    cells += `<button class="cal-cell${isToday ? " today" : ""}${undone ? " has" : ""}" data-day="${day}"><span>${d}</span>${undone ? `<i class="cal-badge">${undone}</i>` : ""}</button>`;
  }
  panel.innerHTML = `
    <div class="cal-head"><button class="cal-nav" id="calPrev">‹</button>
      <div class="cal-title">${viewY}年${viewM + 1}月</div>
      <button class="cal-nav" id="calNext">›</button></div>
    <div class="cal-week">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-todayrow"><button class="cal-today" id="calToday">回到今天</button></div>`;
  $("#calPrev").addEventListener("click", () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderCalPanel(); });
  $("#calNext").addEventListener("click", () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderCalPanel(); });
  $("#calToday").addEventListener("click", () => {
    const n = new Date();
    viewY = n.getFullYear();
    viewM = n.getMonth();
    selDay = todayISO();
    renderCalPanel();
  });
  panel.querySelectorAll(".cal-cell[data-day]").forEach((cell) => {
    cell.addEventListener("click", () => { selDay = cell.dataset.day; renderCalPanel(); });
  });
}

function renderTasks() {
  const wrap = $("#calTasks");
  if (!wrap) return;
  const list = itemsOf(selDay);
  if (!list.length) {
    wrap.innerHTML = `<div class="cal-empty">这一天还没有安排～点下面的“＋”添加</div>`;
    return;
  }
  wrap.innerHTML = "";
  list.forEach((it) => {
    const el = document.createElement("div");
    if (editingId === it.id) {
      el.className = "cal-task edit";
      el.innerHTML = `
        <input class="cal-edittext" id="calEditText" value="${esc(it.text)}" placeholder="工作内容" />
        <input class="cal-edittime" id="calEditTime" type="time" value="${esc(it.time || "")}" />
        <button class="cal-save" id="calSave">保存</button>
        <button class="cal-cancel" id="calCancel">取消</button>`;
      const saveBtn = el.querySelector("#calSave");
      const cancelBtn = el.querySelector("#calCancel");
      const editText = el.querySelector("#calEditText");
      const editTime = el.querySelector("#calEditTime");
      saveBtn.addEventListener("click", () => {
        const t = editText.value.trim();
        if (!t) { toast("内容不能为空", "err"); return; }
        it.text = t;
        it.time = editTime.value || "";
        editingId = null;
        saveItems(selDay, list);
        renderTasks();
        refreshDot();
        renderCalPanel();
        toast("已保存");
      });
      cancelBtn.addEventListener("click", () => {
        editingId = null;
        renderTasks();
      });
      editText.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBtn.click(); });
      wrap.appendChild(el);
      return;
    }
    el.className = "cal-task" + (it.done ? " done" : "");
    el.innerHTML = `
      <label class="cal-check"><input type="checkbox" ${it.done ? "checked" : ""}><span></span></label>
      <div class="cal-task-body"><div class="cal-task-text">${esc(it.text)}</div>${it.time ? `<div class="cal-task-time">🕐 ${esc(it.time)}</div>` : ""}</div>
      <button class="cal-edit" title="编辑">✎</button>
      <button class="cal-del" title="删除">✕</button>`;
    el.querySelector("input").addEventListener("change", (e) => {
      it.done = e.target.checked;
      saveItems(selDay, list);
      renderTasks();
      refreshDot();
      renderCalPanel();
    });
    el.querySelector(".cal-del").addEventListener("click", () => {
      const idx = list.findIndex((x) => x.id === it.id);
      if (idx >= 0) list.splice(idx, 1);
      saveItems(selDay, list);
      renderTasks();
      refreshDot();
    });
    el.querySelector(".cal-edit").addEventListener("click", () => {
      editingId = it.id;
      renderTasks();
    });
    wrap.appendChild(el);
  });
}

function addTask() {
  const text = $("#calNewText")?.value.trim();
  if (!text) {
    toast("请填写工作内容", "err");
    return;
  }
  const time = $("#calNewTime")?.value || "";
  const list = state.calendar[selDay] || (state.calendar[selDay] = []);
  list.push({ id: uid(), text, time, done: false });
  saveItems(selDay, list);
  $("#calNewText").value = "";
  $("#calNewTime").value = "";
  renderTasks();
  refreshDot();
  toast("已添加到日历：" + fmtDisplay(selDay));
}

function tickReminders() {
  const now = new Date();
  const key = todayISO();
  const curHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const list = state.calendar[key] || [];
  for (const it of list) {
    if (it.done) continue;
    if (it.time) {
      const tk = `${key}|${it.time}|${it.id}`;
      if (it.time === curHM && !reminded.has(tk)) {
        reminded.add(tk);
        petRemind(`📌 ${it.text}（${it.time}）`);
        toast(`⏰ 提醒：${it.text}`, "ok", 6500);
      }
    } else {
      const tk = `${key}|allday|${it.id}`;
      if (!reminded.has(tk)) {
        reminded.add(tk);
        petRemind(`📌 今日待办：${it.text}`);
        toast(`今日待办：${it.text}`, "ok", 6500);
      }
    }
  }
}
