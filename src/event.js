// src/event.js
import { initAuthAndRender } from "./auth.js";
import { initUserMenu } from "./userMenu.js";
import {
  getEventById,
  buyShares,
  timeRemaining,
  lmsrPrices,
  lmsrCostDelta,
} from "./storage.js";

let auth;
let me = null; // ✅ 画面の正は常にここ（DOM依存をやめる）
let ev;
let selectedOptionId = null;

/* ================= 共通 ================= */

function idFromQuery() {
  return new URLSearchParams(location.search).get("id");
}

function renderMe(u) {
  me = u && typeof u === "object" ? u : { name: "", points: 0 };
  me.points = Number(me.points || 0);
  me.name = String(me.name || "");

  const pointsEl = document.getElementById("userPoints");
  if (pointsEl) pointsEl.textContent = me.points.toLocaleString();

  const nameEl = document.getElementById("userName");
  if (nameEl) nameEl.textContent = me.name;
}

function updateResolvedBadge() {
  const badge = document.getElementById("resolvedBadge");
  if (!badge) return;
  if (ev.status === "resolved") {
    badge.classList.remove("hidden");
    const ans =
      (ev.options || []).find((o) => o.id === ev.resultOptionId)?.text ?? "-";
    badge.textContent = `確定：${ans}`;
  } else {
    badge.classList.add("hidden");
  }
}

function renderMeta() {
  const end = new Date(ev.endDate);
  const meta = document.getElementById("eventMeta");
  if (meta) {
    meta.textContent = `${end.toLocaleString("ja-JP")}（${timeRemaining(
      ev.endDate
    )}） / ${ev.category}`;
  }
  const titleEl = document.getElementById("title");
  if (titleEl) titleEl.textContent = ev.title ?? "-";
  const descEl = document.getElementById("desc");
  if (descEl) descEl.textContent = ev.description ?? "-";
}

function calcPrices() {
  const q = (ev.options || []).map((o) => Number(o.q || 0));
  return lmsrPrices(q, ev.liquidityB || 50);
}

function getSelectedIndex() {
  return (ev.options || []).findIndex((o) => o.id === selectedOptionId);
}

/* ================= LMSR: bet → shares ================= */

function sharesForBudget(q, idx, bet, b) {
  let lo = 0,
    hi = 1;
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
  // ✅ DOMではなくmeを正にする
  return Number(me?.points || 0);
}

function clampBet(v) {
  const max = getUserPoints();
  const n = Math.max(0, Math.floor(Number(v || 0)));
  return Math.min(n, max);
}

function setBet(v) {
  const x = clampBet(v);
  const input = betInputEl();
  if (input) input.value = String(x);
  const big = betBigEl();
  if (big) big.textContent = String(x.toLocaleString());
  updateBetUI();
}

function updateSheetHeader() {
  const ps = calcPrices();
  const idx = getSelectedIndex();
  const p = idx >= 0 ? Math.round(ps[idx] * 100) : 0;

  const text =
    (ev.options || []).find((o) => o.id === selectedOptionId)?.text ?? "-";
  const optTextEl = document.getElementById("sheetOptionText");
  if (optTextEl) optTextEl.textContent = text;

  const probEl = document.getElementById("sheetProb");
  if (probEl) probEl.textContent = `${p}%`;

  const sideEl = document.getElementById("sheetSideLabel");
  if (sideEl) sideEl.textContent = "Yes";
}

function updateBetUI() {
  const payout = payoutEl();
  if (!payout) return;

  if (!selectedOptionId) {
    payout.textContent = "選択肢を選んでください";
    return;
  }
  const bet = clampBet(betInputEl()?.value);
  const big = betBigEl();
  if (big) big.textContent = String(bet.toLocaleString());

  if (bet <= 0) {
    payout.textContent = "-";
    return;
  }

  const idx = getSelectedIndex();
  const q = (ev.options || []).map((o) => Number(o.q || 0));
  const b = ev.liquidityB || 50;
  const ps = lmsrPrices(q, b);
  const p = Math.min(0.999999, Math.max(0.000001, ps[idx]));

  const profit = Math.max(0, bet / p - bet);
  payout.textContent = `当たると +${Math.round(profit).toLocaleString()} pt（目安）`;
}

/* ================= UI（選択肢一覧） ================= */

function renderOptions() {
  const ps = calcPrices();
  const wrap = document.getElementById("options");
  if (!wrap) return;
  wrap.innerHTML = "";

  (ev.options || []).forEach((o, i) => {
    const pct = Math.round(ps[i] * 100);
    const card = document.createElement("div");
    card.className = "opt rounded-2xl p-4 cursor-pointer";
    card.addEventListener("click", () => {
      if (ev.status === "resolved") return;

      selectedOptionId = o.id;
      document.querySelectorAll(".opt").forEach((x) => x.classList.remove("selected"));
      card.classList.add("selected");

      updateSheetHeader();
      setBet(0);
      const msg = sheetMsgEl();
      if (msg) msg.textContent = "";
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
  const out = await adminApi(
    `/api/admin/users?action=participants&eventId=${ev.id}`
  );
  const wrap = document.getElementById("adminParticipants");
  if (!wrap) return;
  wrap.innerHTML = "";

  (out.participants || []).forEach((p) => {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between gap-2 bg-slate-900/40 border border-slate-700 rounded-lg px-3 py-2";
    row.innerHTML = `
      <div>
        <div class="font-semibold">${p.name}</div>
        <div class="text-xs text-slate-400">${p.deviceId} / shares:${Number(
      p.totalShares || 0
    ).toFixed(2)}</div>
      </div>
      <button class="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-sm">削除</button>
    `;
    row.querySelector("button").onclick = async () => {
      if (!confirm(`${p.name} を削除しますか？`)) return;
      await adminApi(
        `/api/admin/users?action=removeParticipant&eventId=${ev.id}&deviceId=${encodeURIComponent(
          p.deviceId
        )}`,
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

  if (ev.status === "resolved") {
    btn.disabled = true;
    btn.classList.add("opacity-50", "cursor-not-allowed");
    sel.disabled = true;
    sel.classList.add("opacity-50", "cursor-not-allowed");
    const ans =
      (ev.options || []).find((o) => o.id === ev.resultOptionId)?.text ?? "-";
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
  // ✅ initAuthAndRender直後のサーバ整合値を画面の正としてセット
  renderMe({ name: auth.name, points: auth.points });

  initUserMenu();

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.onclick = () =>
      history.length > 1 ? history.back() : (location.href = "index.html");
  }

  const id = idFromQuery();
  if (!id) return;

  ev = await getEventById(id);
  renderMeta();
  renderOptions();
  renderAdminResolveSelect();

  // Sheet close actions
  overlayEl()?.addEventListener("click", () => showSheet(false));
  document.getElementById("sheetClose")?.addEventListener("click", () =>
    showSheet(false)
  );

  // Bet input sync
  betInputEl()?.addEventListener("input", () => {
    const v = clampBet(betInputEl()?.value);
    if (betInputEl()) betInputEl().value = String(v);
    if (betBigEl()) betBigEl().textContent = String(v.toLocaleString());
    updateBetUI();
  });

  // +/- buttons
  const minusBtn = document.getElementById("minusBtn");
  if (minusBtn) minusBtn.onclick = () => setBet(clampBet(Number(betInputEl()?.value) - 10));
  const plusBtn = document.getElementById("plusBtn");
  if (plusBtn) plusBtn.onclick = () => setBet(clampBet(Number(betInputEl()?.value) + 10));

  // quick add
  document.querySelectorAll(".quickBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const add = Number(btn.getAttribute("data-add") || 0);
      setBet(clampBet(Number(betInputEl()?.value) + add));
    });
  });

  const maxBtn = document.getElementById("maxBtn");
  if (maxBtn) maxBtn.onclick = () => setBet(getUserPoints());

  // Trade
  const tradeBtn = document.getElementById("tradeBtn");
  if (tradeBtn) {
    tradeBtn.onclick = async () => {
      const msg = sheetMsgEl();
      if (msg) msg.textContent = "";
      try {
        if (ev.status === "resolved") throw new Error("確定済みです");
        if (!selectedOptionId) throw new Error("選択肢を選んでください");

        const bet = clampBet(betInputEl()?.value);
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

        // ✅ 正は out.user
        if (out?.user) renderMe(out.user);
        ev = out.event;

        // UI refresh
        renderOptions();
        showSheet(false);

        const topMsg = document.getElementById("msg");
        if (topMsg) {
          topMsg.textContent = "賭けました！";
          setTimeout(() => (topMsg.textContent = ""), 1500);
        }
      } catch (e) {
        if (msg) msg.textContent = String(e?.message || e);
      }
    };
  }

  /* 🔑 管理者ショートカット：Ctrl/⌘ + Shift + A */
  window.addEventListener("keydown", async (e) => {
    const meta = navigator.platform.toLowerCase().includes("mac")
      ? e.metaKey
      : e.ctrlKey;
    if (meta && e.shiftKey && (e.key === "A" || e.key === "a")) {
      const code = prompt("管理者コードを入力してください");
      if (!code) return;
      setAdminKey(code.trim());
      try {
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
  const adminRefreshBtn = document.getElementById("adminRefreshBtn");
  if (adminRefreshBtn) adminRefreshBtn.onclick = loadParticipants;

  // 管理者：イベント削除
  const adminDeleteEventBtn = document.getElementById("adminDeleteEventBtn");
  if (adminDeleteEventBtn) {
    adminDeleteEventBtn.onclick = async () => {
      if (!confirm("イベントを削除しますか？")) return;
      await adminApi(`/api/admin/users?action=deleteEvent&eventId=${ev.id}`, {
        method: "POST",
      });
      location.href = "index.html";
    };
  }

  // ✅ 管理者：結果確定（分配）
  const adminResolveBtn = document.getElementById("adminResolveBtn");
  if (adminResolveBtn) {
    adminResolveBtn.onclick = async () => {
      const msg = document.getElementById("adminResolveMsg");
      if (msg) msg.textContent = "";
      try {
        if (ev.status === "resolved") throw new Error("すでに確定済みです");

        const sel = document.getElementById("adminResolveSelect");
        const resultOptionId = Number(sel?.value);
        if (!Number.isFinite(resultOptionId)) throw new Error("結果が不正です");

        const ansText =
          (ev.options || []).find((o) => o.id === resultOptionId)?.text ?? "-";
        if (
          !confirm(
            `結果を「${ansText}」で確定して、分配しますか？（取り消し不可）`
          )
        )
          return;

        const out = await resolveAndPayout(resultOptionId);

        await refresh();
        await loadParticipants();

        if (msg) {
          msg.textContent = `確定しました：${ansText}（支払い件数: ${
            out.count ?? out.payouts?.length ?? 0
          }）`;
        }
      } catch (e) {
        if (msg) msg.textContent = String(e?.message || e);
      }
    };
  }

  // 管理者ログアウト
  const adminLogoutBtn = document.getElementById("adminLogoutBtn");
  if (adminLogoutBtn) {
    adminLogoutBtn.onclick = () => {
      clearAdminKey();
      showAdminPanel(false);
    };
  }
});
