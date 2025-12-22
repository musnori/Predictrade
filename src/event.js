// src/event.js (PM v2 - Ladder UI + betPoints sheet)
import { initAuthAndRender } from "./auth.js";
import { initUserMenu } from "./userMenu.js";
import {
  getEventById,
  getCategoryName,
  placeOrder,
  timeRemaining,
  getMyOpenOrders,
  cancelOrder,
} from "./storage.js";

let auth;
let me = null;
let ev;
let activeEvent = null;

let selectedOutcome = null; // "YES" | "NO"
let sheetPricePct = 50; // 1..99
let sheetBetPoints = 0;

// units: 10000 units = 1pt
const UNIT_SCALE = 10000;

function idFromQuery() {
  return new URLSearchParams(location.search).get("id");
}

function currentEvent() {
  return activeEvent || ev;
}

function isRangeParent() {
  return ev?.type === "range_parent";
}

function unitsToPoints(units) {
  const n = Number(units || 0);
  return Math.floor(n / UNIT_SCALE);
}

function clampPct(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(99, n));
}
function clampPoints(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10_000_000, n));
}

/* ================= Header/User ================= */

function renderMe(u) {
  const name = String(u?.name || u?.displayName || "");
  const pointsMaybe = Number(u?.points || 0);

  const unitsMaybe = Number(
    u?.pointsUnits ?? u?.balanceUnits?.available ?? u?.availableUnits ?? 0
  );

  let points = 0;
  if (Number.isFinite(unitsMaybe) && unitsMaybe >= 0) points = unitsToPoints(unitsMaybe);
  else points = Math.floor(pointsMaybe);

  me = { name, points, unitsAvailable: unitsMaybe };

  const pointsEl = document.getElementById("userPoints");
  if (pointsEl) pointsEl.textContent = me.points.toLocaleString();

  const nameEl = document.getElementById("userName");
  if (nameEl) nameEl.textContent = me.name || "Guest";
}

function renderMeta() {
  const end = new Date(ev.endDate);
  const meta = document.getElementById("eventMeta");
  if (meta) {
    meta.textContent = `${end.toLocaleString("ja-JP")}（${timeRemaining(ev.endDate)}）`;
  }

  const categoryBadge = document.getElementById("categoryBadge");
  if (categoryBadge) {
    categoryBadge.textContent = getCategoryName(ev.category || "other");
  }

  const marketTime = document.getElementById("marketTime");
  if (marketTime) {
    marketTime.textContent = timeRemaining(ev.endDate);
  }
  const titleEl = document.getElementById("title");
  if (titleEl) titleEl.textContent = ev.title ?? "-";
  const descEl = document.getElementById("desc");
  if (descEl) descEl.textContent = ev.description ?? "-";
}

function updateResolvedBadge() {
  const badge = document.getElementById("resolvedBadge");
  if (!badge) return;

  if (ev.status === "resolved") {
    badge.classList.remove("hidden");
    badge.textContent = `確定：${ev.result || "-"}`;
  } else {
    badge.classList.add("hidden");
  }
}

/* ================= Range Outcomes ================= */

function formatRangeLabel(child) {
  const lo = child?.range?.lo;
  const hi = child?.range?.hi;
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    return `${lo}〜${hi}`;
  }
  return child?.title ?? "-";
}

function setActiveEvent(nextEvent) {
  activeEvent = nextEvent || null;
  renderRangeOutcomes();
  renderLadder();
  void renderMyOrders();
}

function renderRangeOutcomes() {
  const wrap = document.getElementById("rangeOutcomes");
  const rows = document.getElementById("rangeRows");
  if (!wrap || !rows) return;

  if (!isRangeParent()) {
    wrap.classList.add("hidden");
    rows.innerHTML = "";
    return;
  }

  const children = Array.isArray(ev?.children) ? ev.children : [];
  if (children.length === 0) {
    wrap.classList.add("hidden");
    rows.innerHTML = "";
    return;
  }

  wrap.classList.remove("hidden");
  rows.innerHTML = "";

  children.forEach((child) => {
    const yesPct = clampPct(Math.round(Number(child?.prices?.yes ?? 0.5) * 100));
    const noPct = 100 - yesPct;
    const selected = activeEvent?.id === child.id;

    const row = document.createElement("div");
    row.className =
      "range-row grid grid-cols-[1fr_auto_auto] gap-3 items-center px-6 py-4 opt" +
      (selected ? " selected" : "");

    row.innerHTML = `
      <div>
        <div class="font-semibold text-slate-200">${formatRangeLabel(child)}</div>
        <div class="text-xs text-slate-400">${child?.stats?.trades ?? 0} trades</div>
      </div>
      <button class="buyYes px-3 py-2 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-600/30 text-emerald-200 text-sm">
        Yes ${yesPct}%
      </button>
      <button class="buyNo px-3 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25 text-sky-100 text-sm">
        No ${noPct}%
      </button>
    `;

    row.addEventListener("click", () => setActiveEvent(child));

    row.querySelector(".buyYes")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (child.status === "resolved") return;
      setActiveEvent(child);
      openSheet("YES", yesPct, child);
    });

    row.querySelector(".buyNo")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (child.status === "resolved") return;
      setActiveEvent(child);
      openSheet("NO", noPct, child);
    });

    rows.appendChild(row);
  });
}

/* ================= Ladder ================= */

function getTickBps() {
  const v = Number(currentEvent()?.market?.tickBps ?? 100);
  return Number.isFinite(v) && v > 0 ? v : 100;
}
function getCenterYesPct() {
  // v2なら ev.market.initialPriceBps、なければ ev.prices.yes、なければ50
  const target = currentEvent();
  const bps =
    Number(target?.market?.initialPriceBps) ||
    Math.round(Number(target?.prices?.yes ?? 0.5) * 10000) ||
    5000;
  const pct = Math.round(bps / 100);
  return clampPct(pct);
}

function buildLadderYesPcts(centerPct, tickBps, rows = 13) {
  const tickPct = Math.max(1, Math.round(tickBps / 100)); // 100bps=1%
  const half = Math.floor(rows / 2);
  const out = [];
  for (let i = half; i >= -half; i--) {
    out.push(clampPct(centerPct + i * tickPct));
  }
  // 重複排除（端でクランプされると同値が出る）
  return Array.from(new Set(out));
}

function renderLadder() {
  const rowsEl = document.getElementById("ladderRows");
  if (!rowsEl) return;
  const target = currentEvent();
  if (!target) {
    rowsEl.innerHTML = "";
    updateMarketSnapshot(50);
    return;
  }

  const center = getCenterYesPct();
  const tickBps = getTickBps();
  const pcts = buildLadderYesPcts(center, tickBps, 13);

  rowsEl.innerHTML = "";
  pcts.forEach((yesPct) => {
    const noPct = 100 - yesPct;

    const row = document.createElement("div");
    row.className =
      "grid grid-cols-3 gap-2 px-6 py-2 border-b border-slate-800 items-center";

    row.innerHTML = `
      <button class="buyYes px-3 py-2 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-600/30 text-emerald-200 text-sm text-left">
        Buy YES
        <div class="text-xs text-emerald-300/80">${yesPct}%</div>
      </button>

      <div class="text-center text-slate-200 font-semibold">
        ${yesPct}%
      </div>

      <button class="buyNo px-3 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25 text-sky-100 text-sm text-right">
        Buy NO
        <div class="text-xs text-sky-200/80">${noPct}%</div>
      </button>
    `;

    row.querySelector(".buyYes")?.addEventListener("click", () => {
      if (target.status === "resolved") return;
      openSheet("YES", yesPct, target);
    });

    row.querySelector(".buyNo")?.addEventListener("click", () => {
      if (target.status === "resolved") return;
      // NOの価格は (100 - YES価格)
      openSheet("NO", noPct, target);
    });

    rowsEl.appendChild(row);
  });

  updateMarketSnapshot(center);
}

function updateMarketSnapshot(yesPct) {
  const yes = clampPct(yesPct ?? getCenterYesPct());
  const no = 100 - yes;

  const yesEl = document.getElementById("marketPriceYes");
  const noEl = document.getElementById("marketPriceNo");
  const splitEl = document.getElementById("marketSplitText");
  const barEl = document.getElementById("marketYesBar");
  const quickYesPrice = document.getElementById("quickYesPrice");
  const quickNoPrice = document.getElementById("quickNoPrice");

  if (yesEl) yesEl.textContent = `${yes}%`;
  if (noEl) noEl.textContent = `${no}%`;
  if (splitEl) splitEl.textContent = `${yes}% / ${no}%`;
  if (barEl) barEl.style.width = `${yes}%`;
  if (quickYesPrice) quickYesPrice.textContent = `${yes}%`;
  if (quickNoPrice) quickNoPrice.textContent = `${no}%`;
}

/* ================= Bottom Sheet ================= */

const overlayEl = () => document.getElementById("sheetOverlay");
const sheetEl = () => document.getElementById("sheet");
const sheetMsgEl = () => document.getElementById("sheetMsg");

const sheetOptionTextEl = () => document.getElementById("sheetOptionText");
const sheetSideLabelEl = () => document.getElementById("sheetSideLabel");
const sheetProbEl = () => document.getElementById("sheetProb");

const betBigEl = () => document.getElementById("betBig");
const betInputEl = () => document.getElementById("betPoints");
const payoutEl = () => document.getElementById("payout");

function showSheet(show) {
  const ov = overlayEl();
  const sh = sheetEl();
  if (!ov || !sh) return;
  ov.classList.toggle("overlay-hidden", !show);
  sh.classList.toggle("sheet-hidden", !show);
  sh.setAttribute("aria-hidden", String(!show));
}

function setSheetMsg(text) {
  const el = sheetMsgEl();
  if (el) el.textContent = text || "";
}

function setSheetPricePct(pct) {
  sheetPricePct = clampPct(pct);
  if (sheetProbEl()) sheetProbEl().textContent = `${sheetPricePct}%`;
  computeDerived();
}

function setBetPoints(v) {
  sheetBetPoints = clampPoints(v);
  if (betInputEl()) betInputEl().value = String(sheetBetPoints);
  if (betBigEl()) betBigEl().textContent = String(sheetBetPoints);
  computeDerived();
}

function computeDerived() {
  // priceBps = 1..99% -> 100..9900
  const priceBps = sheetPricePct * 100;
  const points = sheetBetPoints;

  // points(=pt予算) → qty(shares)
  // costUnits = priceBps * qty
  // pointsUnits = points * UNIT_SCALE
  const qty = Math.floor((points * UNIT_SCALE) / priceBps);

  if (payoutEl()) {
    payoutEl().textContent =
      qty > 0 ? `当たれば ${qty.toLocaleString()} pt（想定）` : "—";
  }
}

function openSheet(outcome, pricePct, targetEvent = currentEvent()) {
  const target = targetEvent || currentEvent();
  activeEvent = target || null;
  selectedOutcome = outcome;
  setSheetMsg("");

  // ヘッダ表示
  if (sheetOptionTextEl()) sheetOptionTextEl().textContent = target?.title ?? ev?.title ?? "-";
  if (sheetSideLabelEl()) sheetSideLabelEl().textContent = outcome === "YES" ? "Yes" : "No";

  setSheetPricePct(pricePct);
  setBetPoints(0);

  showSheet(true);
}

/* ================= My Orders (optional UI) ================= */

async function renderMyOrders() {
  const wrap = document.getElementById("myOrders");
  if (!wrap) return; // event.htmlに無ければ何もしない

  const target = currentEvent();
  if (!target) {
    wrap.innerHTML = `<div class="text-sm font-semibold">My orders</div>
      <div class="mt-3 text-slate-400 text-sm">レンジを選択してください</div>`;
    return;
  }

  let orders = [];
  try {
    const data = await getMyOpenOrders(target.id, auth.deviceId);
    orders = data?.orders || [];
  } catch (error) {
    wrap.innerHTML = `<div class="text-sm font-semibold">My orders</div>
      <div class="mt-3 text-slate-400 text-sm">注文情報の取得に失敗しました</div>`;
    return;
  }

  wrap.innerHTML = `<div class="text-sm font-semibold">My orders</div>`;
  const list = document.createElement("div");
  list.className = "mt-3 space-y-2";
  if (orders.length === 0) {
    list.innerHTML = `<div class="text-slate-400 text-sm">未約定の注文はありません</div>`;
    wrap.appendChild(list);
    return;
  }

  orders.forEach((o) => {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between gap-2 bg-slate-900/40 border border-slate-700 rounded-xl px-3 py-2";

    const pct = Math.round(Number(o.priceBps || 0) / 100);
    const lockedPt = (Number(o.remaining || 0) * Number(o.priceBps || 0)) / UNIT_SCALE;

    row.innerHTML = `
      <div>
        <div class="font-semibold">${o.outcome} @ ${pct}%</div>
        <div class="text-xs text-slate-400">残り: ${Number(o.remaining || 0)} / ロック: ${lockedPt.toFixed(2)} pt</div>
      </div>
      <button class="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm">キャンセル</button>
    `;

    row.querySelector("button").onclick = async () => {
      if (!confirm(`注文をキャンセルしますか？（残り ${o.remaining}）`)) return;
      const out = await cancelOrder(target.id, o.id, auth.deviceId);

      if (out?.balanceUnits) {
        renderMe({ name: me?.name, pointsUnits: out.balanceUnits.available });
      }
      activeEvent = out.event || target;
      await refresh();
      await renderMyOrders();
    };

    list.appendChild(row);
  });

  wrap.appendChild(list);
}

async function refresh() {
  if (!ev) return;
  ev = await getEventById(ev.id);
  if (isRangeParent()) {
    const children = Array.isArray(ev.children) ? ev.children : [];
    activeEvent =
      children.find((child) => child.id === activeEvent?.id) || children[0] || null;
  } else {
    activeEvent = ev;
  }
  renderMeta();
  renderRangeOutcomes();
  renderLadder();
  updateResolvedBadge();
}

/* ================= Boot ================= */

document.addEventListener("DOMContentLoaded", async () => {
  auth = await initAuthAndRender();

  renderMe({
    name: auth?.name,
    points: auth?.points,
    pointsUnits: auth?.pointsUnits,
  });

  initUserMenu();

  document.getElementById("backBtn")?.addEventListener("click", () =>
    history.length > 1 ? history.back() : (location.href = "index.html")
  );

  const id = idFromQuery();
  if (!id) return;

  ev = await getEventById(id);
  if (isRangeParent()) {
    const children = Array.isArray(ev.children) ? ev.children : [];
    activeEvent = children[0] || null;
  } else {
    activeEvent = ev;
  }
  renderMeta();
  renderRangeOutcomes();
  renderLadder();
  updateResolvedBadge();

  await renderMyOrders();

  document.getElementById("quickYesBtn")?.addEventListener("click", () => {
    const target = currentEvent();
    if (!target || target.status === "resolved") return;
    openSheet("YES", getCenterYesPct(), target);
  });

  document.getElementById("quickNoBtn")?.addEventListener("click", () => {
    const target = currentEvent();
    if (!target || target.status === "resolved") return;
    openSheet("NO", 100 - getCenterYesPct(), target);
  });

  // sheet close
  overlayEl()?.addEventListener("click", () => showSheet(false));
  document.getElementById("sheetClose")?.addEventListener("click", () => showSheet(false));

  // bet input wiring
  betInputEl()?.addEventListener("input", () => setBetPoints(betInputEl().value));

  document.getElementById("plusBtn")?.addEventListener("click", () => setBetPoints(sheetBetPoints + 1));
  document.getElementById("minusBtn")?.addEventListener("click", () => setBetPoints(Math.max(0, sheetBetPoints - 1)));

  document.querySelectorAll(".quickBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const add = Number(btn.dataset.add || 0);
      setBetPoints(sheetBetPoints + add);
    });
  });

  document.getElementById("maxBtn")?.addEventListener("click", () => {
    setBetPoints(Math.max(0, Number(me?.points || 0)));
  });

  // trade
  document.getElementById("tradeBtn")?.addEventListener("click", async () => {
    setSheetMsg("");
    try {
      const target = currentEvent();
      if (!target) throw new Error("レンジを選択してください");
      if (target.status === "resolved") throw new Error("確定済みです");
      if (!selectedOutcome) throw new Error("YES/NO を選んでください");

      const priceBps = sheetPricePct * 100;
      const points = sheetBetPoints;

      // points→qty
      const qty = Math.floor((points * UNIT_SCALE) / priceBps);
      if (qty <= 0) throw new Error("ポイントが少なすぎます（qty=0）");

      const out = await placeOrder({
        eventId: target.id,
        deviceId: auth.deviceId,
        name: me?.name || auth?.name || "Guest",
        outcome: selectedOutcome,
        side: "buy",
        priceBps,
        qty,
      });

      if (out?.balanceUnits) {
        renderMe({ name: me?.name, pointsUnits: out.balanceUnits.available });
      }

      await refresh();
      await renderMyOrders();
      showSheet(false);

      const topMsg = document.getElementById("msg");
      if (topMsg) {
        topMsg.textContent =
          out?.filled > 0
            ? `注文しました（約定: ${out.filled} / 残り: ${out.remaining}）`
            : "注文しました（未約定）";
        setTimeout(() => (topMsg.textContent = ""), 2000);
      }
    } catch (e) {
      setSheetMsg(String(e?.message || e));
    }
  });
});
