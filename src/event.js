// src/event.js (PM v2 - Phase1: Buy order + mint on match + cancel open orders)
import { initAuthAndRender } from "./auth.js";
import { initUserMenu } from "./userMenu.js";
import { getEventById, placeOrder, timeRemaining, getMyOpenOrders, cancelOrder } from "./storage.js";

let auth;
let me = null;
let ev;

let selectedOutcome = null; // "YES" | "NO"

// units: 10000 units = 1pt
const UNIT_SCALE = 10000;

function idFromQuery() {
  return new URLSearchParams(location.search).get("id");
}

function unitsToPoints(units) {
  const n = Number(units || 0);
  return Math.floor(n / UNIT_SCALE);
}

function renderMe(u) {
  // auth.jsが旧仕様(points)を返す可能性もあるので両対応
  const name = String(u?.name || u?.displayName || "");
  const pointsMaybe = Number(u?.points || 0);

  // pointsUnits は (available units) を入れる想定
  const unitsMaybe = Number(
    u?.pointsUnits ??
      u?.balanceUnits?.available ??
      u?.availableUnits ??
      0
  );

  let points = 0;
  if (Number.isFinite(unitsMaybe) && unitsMaybe > 0) points = unitsToPoints(unitsMaybe);
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
    meta.textContent = `${end.toLocaleString("ja-JP")}（${timeRemaining(ev.endDate)}） / ${ev.category}`;
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
    const ans = ev.result || "-";
    badge.textContent = `確定：${ans}`;
  } else {
    badge.classList.add("hidden");
  }
}

function currentYesProbPct() {
  // ev.prices = { yes: 0..1, no: 0..1 } 想定（無ければ50%）
  const yes = Number(ev?.prices?.yes ?? 0.5);
  const clamped = Math.max(0, Math.min(1, yes));
  return Math.round(clamped * 100);
}

function renderOptions() {
  const wrap = document.getElementById("options");
  if (!wrap) return;
  wrap.innerHTML = "";

  const yesPct = currentYesProbPct();
  const noPct = 100 - yesPct;

  const items = [
    { outcome: "YES", label: "YES", pct: yesPct },
    { outcome: "NO", label: "NO", pct: noPct },
  ];

  items.forEach((it) => {
    const card = document.createElement("div");
    card.className = "opt rounded-2xl p-4 cursor-pointer";
    card.addEventListener("click", () => {
      if (ev.status === "resolved") return;

      selectedOutcome = it.outcome;
      document.querySelectorAll(".opt").forEach((x) => x.classList.remove("selected"));
      card.classList.add("selected");

      // sheet初期化
      setSheetOutcome(it.outcome);
      setPricePct(it.pct); // 初期は現在確率に寄せる
      setQty(1);
      setSheetMsg("");
      showSheet(true);
    });

    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="font-medium text-lg">${it.label}</div>
        <div class="text-emerald-400 font-bold text-xl">${it.pct}%</div>
      </div>
      <div class="mt-3">
        <div class="w-full bg-slate-700/50 rounded-full h-2">
          <div class="h-2 rounded-full bg-emerald-500" style="width:${it.pct}%"></div>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  });

  updateResolvedBadge();
}

/* ================= Bottom Sheet ================= */

const overlayEl = () => document.getElementById("sheetOverlay");
const sheetEl = () => document.getElementById("sheet");
const sheetMsgEl = () => document.getElementById("sheetMsg");

const outcomeTextEl = () => document.getElementById("sheetOutcomeText"); // "YES/NO"
const probEl = () => document.getElementById("sheetProb"); // "63%"
const priceRangeEl = () => document.getElementById("priceRange"); // range 1..99
const priceInputEl = () => document.getElementById("pricePct"); // number 1..99
const qtyInputEl = () => document.getElementById("qty"); // number
const costEl = () => document.getElementById("costPoints"); // "123 pt"
const fillHintEl = () => document.getElementById("fillHint"); // "約定すれば…"

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

function setSheetOutcome(outcome) {
  const el = outcomeTextEl();
  if (el) el.textContent = outcome;
}

function clampPct(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(99, n)); // 0/100は扱いにくいので除外
}

function getPricePct() {
  return clampPct(priceInputEl()?.value ?? priceRangeEl()?.value ?? 50);
}
function setPricePct(pct) {
  const p = clampPct(pct);
  if (priceRangeEl()) priceRangeEl().value = String(p);
  if (priceInputEl()) priceInputEl().value = String(p);
  if (probEl()) probEl().textContent = `${p}%`;
  updateCostUI();
}

function clampQty(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(5000, n));
}
function getQty() {
  return clampQty(qtyInputEl()?.value ?? 1);
}
function setQty(q) {
  const n = clampQty(q);
  if (qtyInputEl()) qtyInputEl().value = String(n);
  updateCostUI();
}

function updateCostUI() {
  if (!selectedOutcome) return;

  const pct = getPricePct(); // 1..99
  const qty = getQty();

  // 入力pctを「そのアウトカムの価格」として使う
  const priceBps = pct * 100;
  const costUnits = priceBps * qty;

  // 表示はpt（切り上げ表示）
  const costPoints = Math.ceil(costUnits / UNIT_SCALE);
  if (costEl()) costEl().textContent = `${costPoints.toLocaleString()} pt`;

  const hint = fillHintEl();
  if (hint) {
    hint.textContent =
      "※ 約定（相手注文と一致）した分だけシェアが発行されます。未約定分は注文として残り、キャンセルでロックが戻ります。";
  }
}

/* ================= My Orders ================= */

async function renderMyOrders() {
  const wrap = document.getElementById("myOrders");
  if (!wrap) return;

  const data = await getMyOpenOrders(ev.id, auth.deviceId);
  const orders = data?.orders || [];

  wrap.innerHTML = "";
  if (orders.length === 0) {
    wrap.innerHTML = `<div class="text-slate-400 text-sm">未約定の注文はありません</div>`;
    return;
  }

  orders.forEach((o) => {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between gap-2 bg-slate-900/40 border border-slate-700 rounded-lg px-3 py-2";

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

      const out = await cancelOrder(ev.id, o.id, auth.deviceId);

      // 残高更新
      if (out?.balanceUnits) {
        renderMe({
          name: me?.name,
          pointsUnits: out.balanceUnits.available,
        });
      }

      // 再描画
      ev = out.event || ev;
      await refresh();
      await renderMyOrders();
    };

    wrap.appendChild(row);
  });
}

/* ================= refresh ================= */

async function refresh() {
  ev = await getEventById(ev.id);
  renderMeta();
  renderOptions();
  updateResolvedBadge();
}

/* ================= Boot ================= */

document.addEventListener("DOMContentLoaded", async () => {
  auth = await initAuthAndRender();

  // 旧: points / 新: pointsUnits の両対応
  renderMe({
    name: auth?.name,
    points: auth?.points,
    pointsUnits: auth?.pointsUnits,
  });

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
  updateResolvedBadge();

  // My Orders initial
  await renderMyOrders();

  // sheet close
  overlayEl()?.addEventListener("click", () => showSheet(false));
  document.getElementById("sheetClose")?.addEventListener("click", () => showSheet(false));

  // price sync
  priceRangeEl()?.addEventListener("input", () => setPricePct(priceRangeEl()?.value));
  priceInputEl()?.addEventListener("input", () => setPricePct(priceInputEl()?.value));

  // qty sync
  qtyInputEl()?.addEventListener("input", () => setQty(qtyInputEl()?.value));

  // trade
  const tradeBtn = document.getElementById("tradeBtn");
  if (tradeBtn) {
    tradeBtn.onclick = async () => {
      setSheetMsg("");
      try {
        if (ev.status === "resolved") throw new Error("確定済みです");
        if (!selectedOutcome) throw new Error("YES/NO を選んでください");

        const pct = getPricePct();
        const qty = getQty();
        const priceBps = pct * 100;

        const out = await placeOrder({
          eventId: ev.id,
          deviceId: auth.deviceId,
          name: me?.name || auth?.name || "Guest",
          outcome: selectedOutcome,
          side: "buy",
          priceBps,
          qty,
        });

        // 残高更新
        if (out?.balanceUnits) {
          renderMe({
            name: me?.name,
            pointsUnits: out.balanceUnits.available,
          });
        }

        // event & orders refresh
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
    };
  }
});
