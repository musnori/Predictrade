import { initAuthAndRender } from "./auth.js";
import {
  getEventById,
  buyShares,
  addOption,
  resolveEvent,
  timeRemaining,
  lmsrPrices,
  lmsrCostDelta,
} from "./storage.js";

let auth;
let ev;
let selectedOptionId = null;

/* ================= 共通 ================= */

function idFromQuery() {
  return new URLSearchParams(location.search).get("id");
}

function updateResolvedBadge() {
  const badge = document.getElementById("resolvedBadge");
  if (!badge) return;
  if (ev.status === "resolved") {
    badge.classList.remove("hidden");
    const ans = (ev.options || []).find(o => o.id === ev.resultOptionId)?.text ?? "-";
    badge.textContent = `確定：${ans}`;
  } else {
    badge.classList.add("hidden");
  }
}

function renderMeta() {
  const end = new Date(ev.endDate);
  document.getElementById("eventMeta").textContent =
    `${end.toLocaleString("ja-JP")}（${timeRemaining(ev.endDate)}） / ${ev.category}`;
  document.getElementById("title").textContent = ev.title ?? "-";
  document.getElementById("desc").textContent = ev.description ?? "-";
}

function calcPrices() {
  const q = (ev.options || []).map(o => Number(o.q || 0));
  return lmsrPrices(q, ev.liquidityB || 50);
}

function getSelectedIndex() {
  return (ev.options || []).findIndex(o => o.id === selectedOptionId);
}

/* ================= LMSR: bet → shares ================= */

function sharesForBudget(q, idx, bet, b) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 30; k++) {
    if (lmsrCostDelta(q, idx, hi, b) >= bet) break;
    hi *= 2;
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const c = lmsrCostDelta(q, idx, mid, b);
    if (c >= bet) hi = mid;
    else lo = mid;
  }
  return hi;
}

function updateBetUI() {
  const payout = document.getElementById("payout");
  if (!payout) return;

  if (!selectedOptionId) {
    payout.textContent = "選択肢を選んでください";
    return;
  }
  const bet = Number(document.getElementById("betPoints").value || 0);
  if (bet <= 0) {
    payout.textContent = "-";
    return;
  }

  const idx = getSelectedIndex();
  const q = (ev.options || []).map(o => Number(o.q || 0));
  const b = ev.liquidityB || 50;
  const ps = lmsrPrices(q, b);
  const p = Math.min(0.999999, Math.max(0.000001, ps[idx]));

  const profit = Math.max(0, bet / p - bet);
  payout.textContent = `当たると +${Math.round(profit).toLocaleString()} pt（目安）`;
}

/* ================= UI ================= */

function renderOptions() {
  const ps = calcPrices();
  const wrap = document.getElementById("options");
  wrap.innerHTML = "";

  (ev.options || []).forEach((o, i) => {
    const pct = Math.round(ps[i] * 100);
    const card = document.createElement("div");
    card.className = "opt rounded-lg p-4 cursor-pointer";
    card.addEventListener("click", () => {
      selectedOptionId = o.id;
      document.querySelectorAll(".opt").forEach(x => x.classList.remove("selected"));
      card.classList.add("selected");
      updateBetUI();
    });
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="font-medium">${o.text}</div>
        <div class="text-emerald-400 font-bold text-lg">${pct}%</div>
      </div>
      <div class="mt-3">
        <div class="w-full bg-slate-600 rounded-full h-2">
          <div class="h-2 rounded-full bg-emerald-500" style="width:${pct}%"></div>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  });

  updateResolvedBadge();
  updateBetUI();
}

async function refresh() {
  ev = await getEventById(ev.id);
  renderMeta();
  renderOptions();
}

/* ================= 管理者 ================= */

function getAdminKey() {
  return sessionStorage.getItem("ADMIN_KEY") || "";
}
function setAdminKey(k) {
  sessionStorage.setItem("ADMIN_KEY", k);
}
function clearAdminKey() {
  sessionStorage.removeItem("ADMIN_KEY");
}
function showAdminPanel(show) {
  const p = document.getElementById("adminPanel");
  if (p) p.classList.toggle("hidden", !show);
}

async function adminApi(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), "x-admin-key": getAdminKey() },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadParticipants() {
  const out = await adminApi(`/api/admin/events/${ev.id}/participants`);
  const wrap = document.getElementById("adminParticipants");
  wrap.innerHTML = "";
  out.participants.forEach(p => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-2 bg-slate-900/40 border border-slate-700 rounded-lg px-3 py-2";
    row.innerHTML = `
      <div>
        <div class="font-semibold">${p.name}</div>
        <div class="text-xs text-slate-400">${p.deviceId} / shares:${Number(p.totalShares).toFixed(2)}</div>
      </div>
      <button class="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-sm">削除</button>
    `;
    row.querySelector("button").onclick = async () => {
      if (!confirm(`${p.name} を削除しますか？`)) return;
      await adminApi(`/api/admin/events/${ev.id}/participants/${encodeURIComponent(p.deviceId)}`, { method: "POST" });
      await loadParticipants();
    };
    wrap.appendChild(row);
  });
}

/* ================= 起動 ================= */

document.addEventListener("DOMContentLoaded", async () => {
  auth = await initAuthAndRender();

  document.getElementById("backBtn").onclick = () => history.length > 1 ? history.back() : location.href = "index.html";

  const id = idFromQuery();
  if (!id) return;

  ev = await getEventById(id);
  renderMeta();
  renderOptions();

  document.getElementById("betPoints").addEventListener("input", updateBetUI);

  document.getElementById("buyBtn").onclick = async () => {
    const msg = document.getElementById("msg");
    msg.textContent = "";
    try {
      if (!selectedOptionId) throw new Error("選択肢を選んでください");
      const bet = Number(document.getElementById("betPoints").value || 0);
      if (bet <= 0) throw new Error("ポイントが不正です");

      const idx = getSelectedIndex();
      const q = (ev.options || []).map(o => Number(o.q || 0));
      const b = ev.liquidityB || 50;
      const shares = sharesForBudget(q, idx, bet, b);

      const out = await buyShares({
        eventId: ev.id,
        deviceId: auth.deviceId,
        optionId: selectedOptionId,
        shares,
      });

      document.getElementById("userPoints").textContent = out.user.points.toLocaleString();
      ev = out.event;
      msg.textContent = "賭けました！";
      renderOptions();
    } catch (e) {
      msg.textContent = e.message;
    }
  };

  /* 🔑 管理者ショートカット：Ctrl/⌘ + Shift + A */
  window.addEventListener("keydown", async (e) => {
    const meta = navigator.platform.toLowerCase().includes("mac") ? e.metaKey : e.ctrlKey;
    if (meta && e.shiftKey && (e.key === "A" || e.key === "a")) {
      const code = prompt("管理者コードを入力してください");
      if (!code) return;
      setAdminKey(code.trim());
      try {
        await adminApi(`/api/admin/events/${ev.id}/participants`);
        showAdminPanel(true);
        alert("管理者モードON");
        await loadParticipants();
      } catch {
        clearAdminKey();
        alert("管理者コードが違います");
      }
    }
  });

  document.getElementById("adminRefreshBtn").onclick = loadParticipants;

  document.getElementById("adminDeleteEventBtn").onclick = async () => {
    if (!confirm("イベントを削除しますか？")) return;
    await adminApi(`/api/admin/events/${ev.id}/delete`, { method: "POST" });
    alert("削除しました");
    location.href = "index.html";
  };

  document.getElementById("adminLogoutBtn").onclick = () => {
    clearAdminKey();
    showAdminPanel(false);
  };
});
