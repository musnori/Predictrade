import { initAuthAndRender } from "./auth.js";
import {
  getEventById,
  buyShares,
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

/* ================= Bottom Sheet ================= */

const overlayEl = () => document.getElementById("sheetOverlay");
const sheetEl = () => document.getElementById("sheet");
const betInputEl = () => document.getElementById("betPoints");
const betBigEl = () => document.getElementById("betBig");
const payoutEl = () => document.getElementById("payout");
const sheetMsgEl = () => document.getElementById("sheetMsg");

function showSheet(show) {
  const ov = overlayEl();
  const sh = sheetEl();
  if (!ov || !sh) return;
  ov.classList.toggle("overlay-hidden", !show);
  sh.classList.toggle("sheet-hidden", !show);
  sh.setAttribute("aria-hidden", String(!show));
  if (show) setTimeout(() => betInputEl()?.focus(), 50);
}

function getUserPoints() {
  const s = document.getElementById("userPoints")?.textContent || "0";
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function clampBet(v) {
  const max = getUserPoints();
  const n = Math.max(0, Math.floor(Number(v || 0)));
  return Math.min(n, max);
}

function setBet(v) {
  const x = clampBet(v);
  betInputEl().value = String(x);
  betBigEl().textContent = String(x.toLocaleString());
  updateBetUI();
}

function updateSheetHeader() {
  const ps = calcPrices();
  const idx = getSelectedIndex();
  const p = idx >= 0 ? Math.round(ps[idx] * 100) : 0;

  const text = (ev.options || []).find(o => o.id === selectedOptionId)?.text ?? "-";
  document.getElementById("sheetOptionText").textContent = text;
  document.getElementById("sheetProb").textContent = `${p}%`;
  document.getElementById("sheetSideLabel").textContent = "Yes";
}

function updateBetUI() {
  if (!payoutEl()) return;

  if (!selectedOptionId) {
    payoutEl().textContent = "選択肢を選んでください";
    return;
  }
  const bet = clampBet(betInputEl().value);
  betBigEl().textContent = String(bet.toLocaleString());

  if (bet <= 0) {
    payoutEl().textContent = "-";
    return;
  }

  const idx = getSelectedIndex();
  const q = (ev.options || []).map(o => Number(o.q || 0));
  const b = ev.liquidityB || 50;
  const ps = lmsrPrices(q, b);
  const p = Math.min(0.999999, Math.max(0.000001, ps[idx]));

  const profit = Math.max(0, bet / p - bet);
  payoutEl().textContent = `当たると +${Math.round(profit).toLocaleString()} pt（目安）`;
}

/* ================= UI（選択肢一覧） ================= */

function renderOptions() {
  const ps = calcPrices();
  const wrap = document.getElementById("options");
  wrap.innerHTML = "";

  (ev.options || []).forEach((o, i) => {
    const pct = Math.round(ps[i] * 100);
    const card = document.createElement("div");
    card.className = "opt rounded-2xl p-4 cursor-pointer";
    card.addEventListener("click", () => {
      if (ev.status === "resolved") return; // 確定済みなら賭けさせない

      selectedOptionId = o.id;
      document.querySelectorAll(".opt").forEach(x => x.classList.remove("selected"));
      card.classList.add("selected");

      // Polymarket風：タップでBottom Sheet
      updateSheetHeader();
      setBet(0);
      sheetMsgEl().textContent = "";
      showSheet(true);
    });
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="font-medium text-lg">${o.text}</div>
        <div class="text-emerald-400 font-bold text-xl">${pct}%</div>
      </div>
      <div class="mt-3">
        <div class="w-full bg-slate-700/50 rounded-full h-2">
          <div class="h-2 rounded-full bg-emerald-500" style="width:${pct}%"></div>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  });

  updateResolvedBadge();
}

async function refresh() {
  ev = await getEventById(ev.id);
  renderMeta();
  renderOptions();
  renderAdminResolveSelect();
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
  const out = await adminApi(`/api/admin/users?action=participants&eventId=${ev.id}`);
  const wrap = document.getElementById("adminParticipants");
  wrap.innerHTML = "";

  (out.participants || []).forEach((p) => {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between gap-2 bg-slate-900/40 border border-slate-700 rounded-lg px-3 py-2";
    row.innerHTML = `
      <div>
        <div class="font-semibold">${p.name}</div>
        <div class="text-xs text-slate-400">${p.deviceId} / shares:${Number(p.totalShares || 0).toFixed(2)}</div>
      </div>
      <button class="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-sm">削除</button>
    `;
    row.querySelector("button").onclick = async () => {
      if (!confirm(`${p.name} を削除しますか？`)) return;
      await adminApi(
        `/api/admin/users?action=removeParticipant&eventId=${ev.id}&deviceId=${encodeURIComponent(p.deviceId)}`,
        { method: "POST" }
      );
      await loadParticipants();
    };
    wrap.appendChild(row);
  });
}

/* ✅ 管理者：結果確定（分配）UI */

function renderAdminResolveSelect() {
  const sel = document.getElementById("adminResolveSelect");
  const msg = document.getElementById("adminResolveMsg");
  const btn = document.getElementById("adminResolveBtn");
  if (!sel || !btn) return;

  sel.innerHTML = "";
  (ev.options || []).forEach((o) => {
    const op = document.createElement("option");
    op.value = String(o.id);
    op.textContent = o.text;
    sel.appendChild(op);
  });

  // resolvedならUIを無効化
  if (ev.status === "resolved") {
    btn.disabled = true;
    btn.classList.add("opacity-50", "cursor-not-allowed");
    sel.disabled = true;
    sel.classList.add("opacity-50", "cursor-not-allowed");
    const ans = (ev.options || []).find(o => o.id === ev.resultOptionId)?.text ?? "-";
    if (msg) msg.textContent = `確定済み：${ans}`;
  } else {
    btn.disabled = false;
    btn.classList.remove("opacity-50", "cursor-not-allowed");
    sel.disabled = false;
    sel.classList.remove("opacity-50", "cursor-not-allowed");
    if (msg) msg.textContent = "";
  }
}

async function resolveAndPayout(resultOptionId) {
  // ここは「api/events/[id]/resolve.js」に投げる（分配までやってくれる）
  const out = await adminApi(`/api/events/${ev.id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resultOptionId }),
  });
  return out;
}

/* ================= 起動 ================= */

document.addEventListener("DOMContentLoaded", async () => {
  auth = await initAuthAndRender();

  document.getElementById("backBtn").onclick = () =>
    history.length > 1 ? history.back() : (location.href = "index.html");

  const id = idFromQuery();
  if (!id) return;

  ev = await getEventById(id);
  renderMeta();
  renderOptions();
  renderAdminResolveSelect();

  // Sheet close actions
  overlayEl().addEventListener("click", () => showSheet(false));
  document.getElementById("sheetClose").addEventListener("click", () => showSheet(false));

  // Bet input sync
  betInputEl().addEventListener("input", () => {
    const v = clampBet(betInputEl().value);
    betInputEl().value = String(v);
    betBigEl().textContent = String(v.toLocaleString());
    updateBetUI();
  });

  // +/- buttons
  document.getElementById("minusBtn").onclick = () => setBet(clampBet(Number(betInputEl().value) - 10));
  document.getElementById("plusBtn").onclick = () => setBet(clampBet(Number(betInputEl().value) + 10));

  // quick add
  document.querySelectorAll(".quickBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const add = Number(btn.getAttribute("data-add") || 0);
      setBet(clampBet(Number(betInputEl().value) + add));
    });
  });
  document.getElementById("maxBtn").onclick = () => setBet(getUserPoints());

  // Trade
  document.getElementById("tradeBtn").onclick = async () => {
    const msg = sheetMsgEl();
    msg.textContent = "";
    try {
      if (ev.status === "resolved") throw new Error("確定済みです");
      if (!selectedOptionId) throw new Error("選択肢を選んでください");

      const bet = clampBet(betInputEl().value);
      if (bet <= 0) throw new Error("ポイントが不正です");

      const idx = getSelectedIndex();
      const q = (ev.options || []).map((o) => Number(o.q || 0));
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

      // UI refresh
      renderOptions();
      showSheet(false);

      const topMsg = document.getElementById("msg");
      topMsg.textContent = "賭けました！";
      setTimeout(() => (topMsg.textContent = ""), 1500);
    } catch (e) {
      msg.textContent = String(e?.message || e);
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
        // これが通れば管理者
        await adminApi(`/api/admin/users?action=participants&eventId=${ev.id}`);
        showAdminPanel(true);
        alert("管理者モードON");
        await loadParticipants();
        renderAdminResolveSelect();
      } catch (err) {
        console.error(err);
        clearAdminKey();
        alert(`管理者モード起動に失敗: ${String(err?.message || err)}`);
      }
    }
  });

  // 管理者：参加者更新
  document.getElementById("adminRefreshBtn").onclick = loadParticipants;

  // 管理者：イベント削除（既存のadmin/usersルート）
  document.getElementById("adminDeleteEventBtn").onclick = async () => {
    if (!confirm("イベントを削除しますか？")) return;
    await adminApi(`/api/admin/users?action=deleteEvent&eventId=${ev.id}`, { method: "POST" });
    location.href = "index.html";
  };

  // ✅ 管理者：結果確定（分配）
  document.getElementById("adminResolveBtn").onclick = async () => {
    const msg = document.getElementById("adminResolveMsg");
    msg.textContent = "";
    try {
      if (ev.status === "resolved") throw new Error("すでに確定済みです");

      const sel = document.getElementById("adminResolveSelect");
      const resultOptionId = Number(sel.value);
      if (!Number.isFinite(resultOptionId)) throw new Error("結果が不正です");

      const ansText = (ev.options || []).find(o => o.id === resultOptionId)?.text ?? "-";
      if (!confirm(`結果を「${ansText}」で確定して、分配しますか？（取り消し不可）`)) return;

      const out = await resolveAndPayout(resultOptionId);

      // 最新反映
      await refresh();
      await loadParticipants();

      msg.textContent = `確定しました：${ansText}（支払い件数: ${out.count ?? out.payouts?.length ?? 0}）`;
    } catch (e) {
      msg.textContent = String(e?.message || e);
    }
  };

  // 管理者ログアウト
  document.getElementById("adminLogoutBtn").onclick = () => {
    clearAdminKey();
    showAdminPanel(false);
  };
});
