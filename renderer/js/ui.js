// ============================================================
// UI 工具：查询、Toast、Modal、按钮忙态
// ============================================================

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer = null;
export function toast(msg, type = "ok", ms = 2600) {
  const root = $("#toastRoot");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  clearTimeout(toastTimer);
  setTimeout(() => {
    el.style.transition = "opacity 0.3s, transform 0.3s";
    el.style.opacity = "0";
    el.style.transform = "translateY(10px)";
    setTimeout(() => el.remove(), 320);
  }, ms);
}

export function busy(btn, on) {
  if (!btn) return;
  if (on) btn.classList.add("loading");
  else btn.classList.remove("loading");
}

export function modal({ title, body, actions }) {
  const mask = $("#modalMask");
  const box = $("#modalBox");
  box.innerHTML = "";
  if (title) {
    const h = document.createElement("h3");
    h.textContent = title;
    box.appendChild(h);
  }
  if (typeof body === "string") {
    const div = document.createElement("div");
    div.innerHTML = body;
    box.appendChild(div);
  } else if (body) {
    box.appendChild(body);
  }
  const footer = document.createElement("div");
  footer.className = "modal-actions";
  for (const a of actions || []) {
    const btn = document.createElement("button");
    btn.className = a.className || "btn ghost";
    btn.textContent = a.label;
    btn.onclick = async () => {
      let r = a.onClick ? a.onClick() : undefined;
      if (r && typeof r.then === "function") r = await r;
      if (r !== false) closeModal();
    };
    footer.appendChild(btn);
  }
  box.appendChild(footer);
  mask.hidden = false;
  return mask;
}

export function closeModal() {
  $("#modalMask").hidden = true;
}

export function confirmModal(title, msg, onOk, okLabel = "确定") {
  const body = document.createElement("div");
  const p = document.createElement("p");
  p.textContent = msg;
  p.style.color = "var(--muted)";
  body.appendChild(p);
  modal({
    title,
    body,
    actions: [
      { label: "取消", className: "btn ghost" },
      {
        label: okLabel,
        className: "btn primary",
        onClick: () => {
          onOk();
        },
      },
    ],
  });
}

export function fieldModal({ title, fields, onOk, okLabel = "确定" }) {
  const body = document.createElement("div");
  const inputs = {};
  for (const f of fields) {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.className = "field-label";
    span.textContent = f.label;
    label.appendChild(span);
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      input.className = "select";
      for (const o of f.options || []) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        input.appendChild(opt);
      }
    } else {
      input = document.createElement("input");
      input.className = "input";
      input.type = f.type || "text";
    }
    input.value = f.value ?? "";
    if (f.placeholder) input.placeholder = f.placeholder;
    if (f.rows) {
      input = document.createElement("textarea");
      input.className = "textarea";
      input.rows = f.rows;
      input.value = f.value ?? "";
      input.placeholder = f.placeholder || "";
    }
    label.appendChild(input);
    body.appendChild(label);
    inputs[f.key] = input;
  }
  modal({
    title,
    body,
    actions: [
      { label: "取消", className: "btn ghost" },
      {
        label: okLabel,
        className: "btn primary",
        onClick: () => {
          const out = {};
          for (const k of Object.keys(inputs)) out[k] = inputs[k].value.trim();
          onOk(out);
        },
      },
    ],
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板", "ok");
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("已复制到剪贴板", "ok");
      return true;
    } catch {
      toast("复制失败，请手动选择复制", "err");
      return false;
    } finally {
      ta.remove();
    }
  }
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

export function setProgress(bar, percentEl, value) {
  const pct = Math.max(0, Math.min(100, value));
  if (bar) bar.style.width = pct + "%";
  if (percentEl) percentEl.textContent = Math.round(pct) + "%";
}
