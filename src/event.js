// src/event.js (PM v2 - Ladder UI + betPoints sheet)
import { initAuthAndRender } from "./auth.js";
import { initUserMenu } from "./userMenu.js";
import {
  getEventById,
  getCategoryName,
  placeOrder,
  timeRemaining,
  cancelOrder,
  addClarification,
  resolveEvent,
  deleteEvent,
  getAdminEventStats,
} from "./storage.js";

let auth;
let me = null;
let ev;
let activeEvent = null;

let selectedOutcome = null; // "YES" | "NO"
let orderSide = "buy"; // buy | sell
let sheetPricePct = 50; // 1..99
let sheetBasePricePct = 50;
let sheetBetPoints = 0;

// units: 10000 units = 1pt
const UNIT_SCALE = 10000;
let adminKeyState = { key: "", ok: false, checked: false };

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

function getAdminKey() {
  return adminKeyState.ok ? adminKeyState.key : "";
}

async function verifyAdminKey(key) {
  if (!key) return false;
  const res = await fetch(`/api/admin/snapshot?key=${encodeURIComponent(key)}`);
  return res.ok;
}

async function ensureAdminAccess() {
  const key = adminKeyState.key;
  if (!key) {
    adminKeyState = { key: "", ok: false, checked: false };
    return false;
  }
  if (adminKeyState.checked) return adminKeyState.ok;

  const ok = await verifyAdminKey(key);
  adminKeyState = { key, ok, checked: true };
  return ok;
}

function setAdminGateVisible(show) {
  const gate = document.getElementById("adminGate");
  if (!gate) return;
  gate.classList.toggle("hidden", !show);
}

function setAdminGateMsg(text) {
  const msg = document.getElementById("adminGateMsg");
  if (msg) msg.textContent = text || "";
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
  } else if (ev.status === "tradingClosed") {
    badge.classList.remove("hidden");
    badge.textContent = "取引終了";
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
  void renderAdminPanel();
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
      if (child.status === "resolved" || child.status === "tradingClosed") return;
      setActiveEvent(child);
      openSheet("YES", yesPct, child);
    });

    row.querySelector(".buyNo")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (child.status === "resolved" || child.status === "tradingClosed") return;
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
      if (target.status === "resolved" || target.status === "tradingClosed") return;
      openSheet("YES", yesPct, target);
    });

    row.querySelector(".buyNo")?.addEventListener("click", () => {
      if (target.status === "resolved" || target.status === "tradingClosed") return;
      // NOの価格は (100 - YES価格)
      openSheet("NO", noPct, target);
    });

    rowsEl.appendChild(row);
  });

  updateMarketSnapshot();
}

function fmtPctFromBps(bps) {
  if (!Number.isFinite(bps)) return "-";
  return `${Math.round(bps / 100)}%`;
}

function renderOrderbook() {
  const target = currentEvent();
  const yesBidsEl = document.getElementById("yesBids");
  const yesAsksEl = document.getElementById("yesAsks");
  const noBidsEl = document.getElementById("noBids");
  const noAsksEl = document.getElementById("noAsks");
  const statusEl = document.getElementById("orderbookStatus");

  if (!yesBidsEl || !yesAsksEl || !noBidsEl || !noAsksEl) return;

  const orderbook = target?.orderbook;
  if (!orderbook) {
    yesBidsEl.innerHTML = "<div class='text-xs text-slate-500'>-</div>";
    yesAsksEl.innerHTML = "<div class='text-xs text-slate-500'>-</div>";
    noBidsEl.innerHTML = "<div class='text-xs text-slate-500'>-</div>";
    noAsksEl.innerHTML = "<div class='text-xs text-slate-500'>-</div>";
    if (statusEl) statusEl.textContent = "-";
    return;
  }

  const renderLevels = (levels) =>
    levels
      .slice(0, 6)
      .map(
        (lvl) => `
        <div class="flex items-center justify-between text-xs bg-slate-900/40 border border-slate-800 rounded-lg px-2 py-1">
          <span>${fmtPctFromBps(lvl.priceBps)}</span>
          <span class="text-slate-400">${Number(lvl.qty || 0)}</span>
        </div>`
      )
      .join("");

  yesBidsEl.innerHTML = renderLevels(orderbook.yes?.bids || []);
  yesAsksEl.innerHTML = renderLevels(orderbook.yes?.asks || []);
  noBidsEl.innerHTML = renderLevels(orderbook.no?.bids || []);
  noAsksEl.innerHTML = renderLevels(orderbook.no?.asks || []);

  if (statusEl) statusEl.textContent = `open orders: ${orderbook.openOrders || 0}`;
}

function renderRules() {
  const rulesEl = document.getElementById("rulesText");
  const updatesEl = document.getElementById("rulesUpdates");
  const sourceEl = document.getElementById("resolutionSourceText");
  if (rulesEl) rulesEl.textContent = ev?.rules || ev?.description || "-";
  if (sourceEl) sourceEl.textContent = ev?.resolutionSource || "-";
  if (!updatesEl) return;
  const updates = Array.isArray(ev?.rulesUpdates) ? ev.rulesUpdates : [];
  if (updates.length === 0) {
    updatesEl.innerHTML = `<div class="text-xs text-slate-500">追加コンテキストはありません</div>`;
    return;
  }
  updatesEl.innerHTML = "";
  updates
    .slice()
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .forEach((u) => {
      const row = document.createElement("div");
      row.className = "rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2";
      row.innerHTML = `
        <div class="text-xs text-slate-500">${new Date(u.at).toLocaleString("ja-JP")} • ${u.by || "admin"}</div>
        <div class="mt-1">${u.text}</div>
      `;
      updatesEl.appendChild(row);
    });
}

async function renderTrades() {
  const listEl = document.getElementById("tradeRows");
  if (!listEl) return;
  const trades = Array.isArray(ev?.trades) ? ev.trades : [];
  if (!trades.length) {
    listEl.innerHTML = `<div class="text-xs text-slate-500">まだ約定がありません</div>`;
    return;
  }
  listEl.innerHTML = "";
  trades.forEach((t) => {
    const yesPct = Math.round(Number(t.yesPriceBps || 0) / 100);
    const row = document.createElement("div");
    row.className = "flex items-center justify-between text-xs bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2";
    row.innerHTML = `
      <div>${new Date(t.createdAt).toLocaleTimeString("ja-JP")} • ${t.kind || "-"}</div>
      <div class="text-slate-300">${yesPct}% • ${t.qty} shares</div>
    `;
    listEl.appendChild(row);
  });
}

async function renderPositions() {
  const posYes = document.getElementById("posYes");
  const posNo = document.getElementById("posNo");
  const posValue = document.getElementById("positionsValue");
  const target = currentEvent();
  if (!target || !posYes || !posNo || !posValue) return;

  const position = target?.position ?? ev?.position;
  if (!position) {
    posYes.textContent = "-";
    posNo.textContent = "-";
    posValue.textContent = "-";
    return;
  }

  const yesQty = Number(position?.yesQty || 0);
  const noQty = Number(position?.noQty || 0);
  const yesPrice = Number(target?.prices?.yes ?? 0);
  const noPrice = Number(target?.prices?.no ?? 0);
  const val = yesQty * yesPrice + noQty * noPrice;

  posYes.textContent = yesQty.toLocaleString();
  posNo.textContent = noQty.toLocaleString();
  posValue.textContent = `${val.toFixed(2)} pt`;
}

function updateMarketSnapshot() {
  const target = currentEvent();
  const yesPct = clampPct(
    Math.round(Number(target?.prices?.yes ?? 0.5) * 100) || getCenterYesPct()
  );
  const noPct = 100 - yesPct;

  const yesEl = document.getElementById("marketPriceYes");
  const noEl = document.getElementById("marketPriceNo");
  const splitEl = document.getElementById("marketSplitText");
  const barEl = document.getElementById("marketYesBar");
  const quickYesPrice = document.getElementById("quickYesPrice");
  const quickNoPrice = document.getElementById("quickNoPrice");

  if (yesEl) yesEl.textContent = `${yesPct}%`;
  if (noEl) noEl.textContent = `${noPct}%`;
  if (splitEl) splitEl.textContent = `${yesPct}% / ${noPct}%`;
  if (barEl) barEl.style.width = `${yesPct}%`;
  if (quickYesPrice) quickYesPrice.textContent = `${yesPct}%`;
  if (quickNoPrice) quickNoPrice.textContent = `${noPct}%`;

  const bestBidYes = document.getElementById("bestBidYes");
  const bestAskYes = document.getElementById("bestAskYes");
  const spreadEl = document.getElementById("marketSpread");
  const sourceEl = document.getElementById("displaySource");

  const bidBps = Number(target?.bestBidsBps?.yes);
  const askBps = Number(target?.bestAsksBps?.yes);
  const spreadBps = Number(target?.prices?.spreadYesBps);
  const source = target?.prices?.source || "-";

  if (bestBidYes) bestBidYes.textContent = Number.isFinite(bidBps) ? `${Math.round(bidBps / 100)}%` : "-";
  if (bestAskYes) bestAskYes.textContent = Number.isFinite(askBps) ? `${Math.round(askBps / 100)}%` : "-";
  if (spreadEl) {
    spreadEl.textContent =
      Number.isFinite(spreadBps) ? `${(spreadBps / 100).toFixed(2)}%` : "-";
  }
  if (sourceEl) sourceEl.textContent = source;
}

/* ================= Bottom Sheet ================= */

const overlayEl = () => document.getElementById("sheetOverlay");
const sheetEl = () => document.getElementById("sheet");
const sheetMsgEl = () => document.getElementById("sheetMsg");

const sheetOptionTextEl = () => document.getElementById("sheetOptionText");
const sheetSideLabelEl = () => document.getElementById("sheetSideLabel");
const sheetProbEl = () => document.getElementById("sheetProb");
const betUnitEl = () => document.getElementById("betUnit");

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

function setOrderSide(next) {
  orderSide = next;
  const buyBtn = document.getElementById("orderBuyBtn");
  const sellBtn = document.getElementById("orderSellBtn");
  if (buyBtn && sellBtn) {
    const buyActive = orderSide === "buy";
    buyBtn.className = buyActive
      ? "flex-1 px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-600/40 text-emerald-200 text-sm"
      : "flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-sm";
    sellBtn.className = !buyActive
      ? "flex-1 px-3 py-2 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-100 text-sm"
      : "flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-sm";
  }
  if (betUnitEl()) betUnitEl().textContent = orderSide === "sell" ? "shares" : "pt";
  computeDerived();
}

function computeImpactPct(points) {
  const liquidity = Number(currentEvent()?.market?.liquidityPoints ?? 500);
  const tickPct = Math.max(1, Math.round(getTickBps() / 100));
  const safeLiquidity = Number.isFinite(liquidity) && liquidity > 0 ? liquidity : 500;
  const rawImpact = (Number(points || 0) / safeLiquidity) * 10;
  const stepped = Math.round(rawImpact / tickPct) * tickPct;
  return Math.min(20, Math.max(0, stepped));
}

function computePricePctForPoints(points) {
  const base = clampPct(sheetBasePricePct);
  const impact = computeImpactPct(points);
  if (selectedOutcome === "NO") return clampPct(base - impact);
  return clampPct(base + impact);
}

function setBetPoints(v) {
  sheetBetPoints = clampPoints(v);
  if (betInputEl()) betInputEl().value = String(sheetBetPoints);
  if (betBigEl()) betBigEl().textContent = String(sheetBetPoints);
  setSheetPricePct(computePricePctForPoints(sheetBetPoints));
}

function computeDerived() {
  // priceBps = 1..99% -> 100..9900
  const priceBps = sheetPricePct * 100;
  const amount = sheetBetPoints;

  if (orderSide === "buy") {
    const qty = Math.floor((amount * UNIT_SCALE) / priceBps);
    if (payoutEl()) {
      payoutEl().textContent =
        qty > 0 ? `当たれば ${qty.toLocaleString()} pt（想定）` : "—";
    }
  } else {
    const proceeds = (amount * priceBps) / UNIT_SCALE;
    if (payoutEl()) {
      payoutEl().textContent =
        amount > 0 ? `受取見込み ${proceeds.toFixed(2)} pt` : "—";
    }
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

  sheetBasePricePct = clampPct(pricePct);
  setSheetPricePct(sheetBasePricePct);
  setBetPoints(0);
  setOrderSide("buy");

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
  orders = Array.isArray(ev?.myOpenOrders) ? ev.myOpenOrders : [];

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
    const sideLabel = o.side === "sell" ? "SELL" : "BUY";
    const lockText =
      o.side === "sell"
        ? `ロック: ${Number(o.remaining || 0)} shares`
        : `ロック: ${lockedPt.toFixed(2)} pt`;

    row.innerHTML = `
      <div>
        <div class="font-semibold">${sideLabel} ${o.outcome} @ ${pct}%</div>
        <div class="text-xs text-slate-400">残り: ${Number(o.remaining || 0)} / ${lockText}</div>
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

async function renderAdminPanel() {
  const panel = document.getElementById("adminPanel");
  if (!panel) return;
  const ok = await ensureAdminAccess();
  if (!ok) {
    panel.classList.add("hidden");
    setAdminGateVisible(true);
    return;
  }
  panel.classList.remove("hidden");
  setAdminGateVisible(false);

  const targetEvent = ev?.type === "range_parent" ? currentEvent() : ev;
  if (!targetEvent) return;

  const select = document.getElementById("adminResolveSelect");
  if (select) {
    const resolveTarget = ev?.type === "range_parent" ? ev : currentEvent();
    const isRangeParent = resolveTarget?.type === "range_parent";
    const options = isRangeParent
      ? (Array.isArray(resolveTarget?.children) ? resolveTarget.children : []).map((child) => ({
          value: child.id,
          label: formatRangeLabel(child),
        }))
      : (Array.isArray(resolveTarget?.outcomes) && resolveTarget.outcomes.length > 0
          ? resolveTarget.outcomes
          : ["YES", "NO"]
        ).map((outcome) => ({
          value: String(outcome).toUpperCase(),
          label: String(outcome).toUpperCase(),
        }));

    select.innerHTML = options
      .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
      .join("");
  }

  const participants = document.getElementById("adminParticipants");
  if (participants) {
    participants.innerHTML = "<div class='text-xs text-slate-500'>読み込み中...</div>";
  }

  try {
    const key = getAdminKey();
    const stats = await getAdminEventStats(targetEvent.id, key);
    if (!participants) return;

    const summary = stats?.summary || {};
    const eventInfo = stats?.event || {};
    const payoutRows = Array.isArray(stats?.payouts) ? stats.payouts : [];
    const people = Array.isArray(stats?.participants) ? stats.participants : [];

    const payoutMarkup = payoutRows.length
      ? `
        <div class="mt-3 text-xs text-slate-400">配当（${eventInfo.result || "-"}）</div>
        <div class="mt-2 space-y-1 text-xs">
          ${payoutRows
            .map(
              (p) => `
                <div class="flex items-center justify-between bg-slate-900/40 border border-slate-700 rounded-lg px-2 py-1">
                  <span>${p.name}</span>
                  <span class="text-emerald-300">${p.paidPoints.toLocaleString()} pt</span>
                </div>
              `
            )
            .join("")}
        </div>`
      : "";

    participants.innerHTML = `
      <div class="text-xs text-slate-400">参加者: ${summary.participantsCount ?? 0}人</div>
      <div class="text-xs text-slate-400">Trades: ${summary.tradesCount ?? 0} / Open orders: ${summary.openOrdersCount ?? 0}</div>
      <div class="text-xs text-slate-400">集計ポイント: ${(summary.collateralPoints ?? 0).toFixed(2)} pt</div>
      <div class="text-xs text-slate-400">YES票: ${summary.yesShares ?? 0} / NO票: ${summary.noShares ?? 0}</div>
      ${
        eventInfo.status === "resolved"
          ? `<div class="text-xs text-emerald-300">結果: ${eventInfo.result || "-"}</div>`
          : ""
      }
      <div class="mt-3 text-xs text-slate-400">参加者内訳</div>
      <div class="mt-2 space-y-1 text-xs">
        ${people
          .map(
            (p) => `
              <div class="flex items-center justify-between bg-slate-900/40 border border-slate-700 rounded-lg px-2 py-1">
                <span>${p.name}</span>
                <span class="text-slate-400">YES ${p.yesQty} / NO ${p.noQty} • orders ${p.openOrders} • trades ${p.trades}</span>
              </div>
            `
          )
          .join("") || "<div class='text-slate-500'>参加者がいません</div>"}
      </div>
      ${payoutMarkup}
    `;
  } catch (e) {
    if (participants) {
      participants.innerHTML = `<div class="text-xs text-amber-200">${String(e?.message || e)}</div>`;
    }
  }
}

async function handleAdminResolve() {
  const msg = document.getElementById("adminResolveMsg");
  if (msg) msg.textContent = "";
  const deleteMsg = document.getElementById("adminDeleteMsg");
  if (deleteMsg) deleteMsg.textContent = "";
  const key = getAdminKey();
  if (!key) return;
  const select = document.getElementById("adminResolveSelect");
  const result = select?.value;
  if (!result) return;

  try {
    if (ev?.type === "range_parent") {
      const children = Array.isArray(ev?.children) ? ev.children : [];
      if (children.length === 0) throw new Error("子イベントがありません");
      const hasResolved = children.some((child) => child.status === "resolved");
      if (hasResolved) throw new Error("既に確定済みの子イベントがあります");

      for (const child of children) {
        const outcome = child.id === result ? "YES" : "NO";
        await resolveEvent({ eventId: child.id, result: outcome }, key);
      }
      await refresh();
      if (msg) msg.textContent = "レンジを確定しました";
      return;
    }

    await resolveEvent({ eventId: currentEvent().id, result }, key);
    await refresh();
    if (msg) msg.textContent = "確定しました";
  } catch (e) {
    if (msg) msg.textContent = String(e?.message || e);
  }
}

async function handleAdminDelete() {
  const msg = document.getElementById("adminDeleteMsg");
  if (msg) msg.textContent = "";
  const key = getAdminKey();
  if (!key) return;
  const target = ev?.type === "range_parent" ? ev : currentEvent();
  if (!target) return;

  const confirmed = confirm("このイベントを削除しますか？（元に戻せません）");
  if (!confirmed) return;

  try {
    await deleteEvent(target.id, key);
    if (msg) msg.textContent = "イベントを削除しました";
    setTimeout(() => {
      location.href = "index.html";
    }, 600);
  } catch (e) {
    if (msg) msg.textContent = String(e?.message || e);
  }
}

async function handleAdminClarify() {
  const msg = document.getElementById("adminClarifyMsg");
  if (msg) msg.textContent = "";
  const key = getAdminKey();
  if (!key) return;
  const text = document.getElementById("adminClarifyText")?.value?.trim();
  const by = document.getElementById("adminClarifyBy")?.value?.trim();
  if (!text) {
    if (msg) msg.textContent = "追記内容を入力してください";
    return;
  }
  try {
    await addClarification({ eventId: currentEvent().id, text, by }, key);
    document.getElementById("adminClarifyText").value = "";
    await refresh();
    if (msg) msg.textContent = "追加しました";
  } catch (e) {
    if (msg) msg.textContent = String(e?.message || e);
  }
}

async function refresh() {
  if (!ev) return;
  ev = await getEventById(ev.id, auth.deviceId);
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
  renderOrderbook();
  renderRules();
  await renderTrades();
  await renderPositions();
  await renderAdminPanel();
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

  ev = await getEventById(id, auth.deviceId);
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
  renderOrderbook();
  renderRules();

  await renderMyOrders();
  await renderTrades();
  await renderPositions();
  await renderAdminPanel();

  document.getElementById("quickYesBtn")?.addEventListener("click", () => {
    const target = currentEvent();
    if (!target || target.status === "resolved" || target.status === "tradingClosed") return;
    openSheet("YES", getCenterYesPct(), target);
  });

  document.getElementById("quickNoBtn")?.addEventListener("click", () => {
    const target = currentEvent();
    if (!target || target.status === "resolved" || target.status === "tradingClosed") return;
    openSheet("NO", 100 - getCenterYesPct(), target);
  });

  // sheet close
  overlayEl()?.addEventListener("click", () => showSheet(false));
  document.getElementById("sheetClose")?.addEventListener("click", () => showSheet(false));

  // bet input wiring
  betInputEl()?.addEventListener("input", () => setBetPoints(betInputEl().value));

  document.getElementById("orderBuyBtn")?.addEventListener("click", () => setOrderSide("buy"));
  document.getElementById("orderSellBtn")?.addEventListener("click", () => setOrderSide("sell"));

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

  document.getElementById("adminResolveBtn")?.addEventListener("click", async () => {
    await handleAdminResolve();
  });
  document.getElementById("adminDeleteEventBtn")?.addEventListener("click", async () => {
    await handleAdminDelete();
  });
  document.getElementById("adminClarifyBtn")?.addEventListener("click", async () => {
    await handleAdminClarify();
  });
  document.getElementById("adminLogoutBtn")?.addEventListener("click", () => {
    adminKeyState = { key: "", ok: false, checked: false };
    void renderAdminPanel();
  });
  document.getElementById("adminRefreshBtn")?.addEventListener("click", async () => {
    await refresh();
  });
  document.getElementById("adminKeySaveBtn")?.addEventListener("click", async () => {
    setAdminGateMsg("");
    const input = document.getElementById("adminKeyEntry");
    const raw = input?.value?.trim();
    if (!raw) {
      setAdminGateMsg("管理者コードを入力してください");
      return;
    }
    const ok = await verifyAdminKey(raw);
    if (!ok) {
      setAdminGateMsg("管理者コードが正しくありません");
      return;
    }
    adminKeyState = { key: raw, ok: true, checked: true };
    if (input) input.value = "";
    await renderAdminPanel();
  });
  // trade
  document.getElementById("tradeBtn")?.addEventListener("click", async () => {
    setSheetMsg("");
    try {
      const target = currentEvent();
      if (!target) throw new Error("レンジを選択してください");
      if (target.status === "resolved" || target.status === "canceled" || target.status === "tradingClosed")
        throw new Error("確定済みです");
      if (!selectedOutcome) throw new Error("YES/NO を選んでください");

      const priceBps = sheetPricePct * 100;
      let qty = 0;
      if (orderSide === "buy") {
        const points = sheetBetPoints;
        qty = Math.floor((points * UNIT_SCALE) / priceBps);
        if (qty <= 0) throw new Error("ポイントが少なすぎます（qty=0）");
      } else {
        qty = Math.floor(sheetBetPoints);
        if (qty <= 0) throw new Error("売却株数を入力してください");
      }

      const out = await placeOrder({
        eventId: target.id,
        deviceId: auth.deviceId,
        name: me?.name || auth?.name || "Guest",
        outcome: selectedOutcome,
        side: orderSide,
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
