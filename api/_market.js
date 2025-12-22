import { kv } from "@vercel/kv";
import { k, PRICE_SCALE } from "./_kv.js";

function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clampBps(v) {
  const n = Math.round(toNum(v, PRICE_SCALE / 2));
  return Math.max(0, Math.min(PRICE_SCALE, n));
}

function normalizeOutcome(v) {
  return String(v || "").toUpperCase();
}

export async function listOpenOrders(eventId) {
  const ids = await kv.smembers(k.ordersByEvent(eventId));
  const out = [];
  for (const oid of Array.isArray(ids) ? ids : []) {
    const o = await kv.get(k.order(eventId, oid));
    if (!o || typeof o !== "object") continue;
    if (o.status !== "open") continue;
    const remaining = toNum(o.remaining, 0);
    if (remaining <= 0) continue;
    out.push({ ...o, remaining });
  }
  return out;
}

function aggregateByPrice(orders, side) {
  const levels = new Map();
  orders.forEach((o) => {
    const price = clampBps(o.priceBps);
    const entry = levels.get(price) || { priceBps: price, qty: 0, orderCount: 0 };
    entry.qty += toNum(o.remaining, 0);
    entry.orderCount += 1;
    levels.set(price, entry);
  });

  const list = Array.from(levels.values());
  list.sort((a, b) =>
    side === "buy" ? b.priceBps - a.priceBps : a.priceBps - b.priceBps
  );
  return list;
}

export async function computeOrderbook(eventId) {
  const opens = await listOpenOrders(eventId);
  const yesBuys = opens.filter((o) => normalizeOutcome(o.outcome) === "YES" && o.side === "buy");
  const yesSells = opens.filter((o) => normalizeOutcome(o.outcome) === "YES" && o.side === "sell");
  const noBuys = opens.filter((o) => normalizeOutcome(o.outcome) === "NO" && o.side === "buy");
  const noSells = opens.filter((o) => normalizeOutcome(o.outcome) === "NO" && o.side === "sell");

  const yesBids = aggregateByPrice(yesBuys, "buy");
  const yesAsks = aggregateByPrice(yesSells, "sell");
  const noBids = aggregateByPrice(noBuys, "buy");
  const noAsks = aggregateByPrice(noSells, "sell");

  const bestYesBid = yesBids[0]?.priceBps ?? null;
  const bestNoBid = noBids[0]?.priceBps ?? null;

  const bestYesAsk =
    yesAsks[0]?.priceBps ?? (bestNoBid != null ? PRICE_SCALE - bestNoBid : null);
  const bestNoAsk =
    noAsks[0]?.priceBps ?? (bestYesBid != null ? PRICE_SCALE - bestYesBid : null);

  return {
    yes: {
      bids: yesBids,
      asks: yesAsks,
      bestBidBps: bestYesBid,
      bestAskBps: bestYesAsk,
    },
    no: {
      bids: noBids,
      asks: noAsks,
      bestBidBps: bestNoBid,
      bestAskBps: bestNoAsk,
    },
    openOrders: opens.length,
  };
}

export async function getLastTrade(eventId) {
  const tradeIds = await kv.lrange(k.tradesByEvent(eventId), -1, -1).catch(() => []);
  const lastId = Array.isArray(tradeIds) ? tradeIds[0] : null;
  if (!lastId) return null;
  const t = await kv.get(k.trade(eventId, lastId));
  if (!t || typeof t !== "object") return null;
  const yesPriceBps = clampBps(t.yesPriceBps);
  const noPriceBps = clampBps(t.noPriceBps);
  return { trade: t, yesPriceBps, noPriceBps };
}

export function computeDisplayPrice(orderbook, lastTrade) {
  const yesBid = orderbook?.yes?.bestBidBps;
  const yesAsk = orderbook?.yes?.bestAskBps;
  const lastYes = lastTrade?.yesPriceBps ?? null;

  let midpoint = null;
  let spreadBps = null;
  if (yesBid != null && yesAsk != null) {
    midpoint = clampBps(Math.round((yesBid + yesAsk) / 2));
    spreadBps = clampBps(yesAsk) - clampBps(yesBid);
  }

  let displayYes = midpoint;
  let source = "midpoint";

  if (spreadBps == null) {
    displayYes = lastYes ?? midpoint ?? PRICE_SCALE / 2;
    source = lastYes != null ? "lastTrade" : "unpriced";
  } else if (spreadBps > 1000) {
    displayYes = lastYes ?? midpoint ?? PRICE_SCALE / 2;
    source = lastYes != null ? "lastTrade" : "midpoint";
  }

  displayYes = clampBps(displayYes ?? PRICE_SCALE / 2);

  return {
    displayYesBps: displayYes,
    displayNoBps: PRICE_SCALE - displayYes,
    midpointYesBps: midpoint,
    spreadYesBps: spreadBps,
    source,
  };
}
