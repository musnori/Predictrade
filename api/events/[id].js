// api/events/[id].js (PM v2) ✅ FULL
import { kv } from "@vercel/kv";
import { getEvent, k, PRICE_SCALE, bpsToProb, listChildEventIds } from "../_kv.js";



function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function clampBps(v) {
  const n = Math.round(toNum(v, PRICE_SCALE / 2));
  return Math.max(0, Math.min(PRICE_SCALE, n));
}

async function getLastYesPriceBps(eventId) {
  try {
    const tradeIds = await kv.lrange(k.tradesByEvent(eventId), -1, -1);
    const lastId = Array.isArray(tradeIds) ? tradeIds[0] : null;
    if (!lastId) return PRICE_SCALE / 2;

    const t = await kv.get(k.trade(eventId, lastId));
    if (!t || typeof t !== "object") return PRICE_SCALE / 2;

    return clampBps(t.yesPriceBps);
  } catch {
    return PRICE_SCALE / 2;
  }
}

async function computeMarketFor(eventId) {
  // compute best bids from open orders
  const ids = await kv.smembers(k.ordersByEvent(eventId));
  let yesBest = null;
  let noBest = null;
  let openOrders = 0;

  for (const oid of Array.isArray(ids) ? ids : []) {
    const o = await kv.get(k.order(eventId, oid));
    if (!o || typeof o !== "object") continue;
    if (o.status !== "open") continue;

    const rem = toNum(o.remaining, 0);
    if (rem <= 0) continue;

    openOrders++;

    const pb = clampBps(o.priceBps);
    const oc = String(o.outcome || "").toUpperCase();
    if (oc === "YES") yesBest = yesBest == null ? pb : Math.max(yesBest, pb);
    if (oc === "NO") noBest = noBest == null ? pb : Math.max(noBest, pb);
  }

  // fallback: last trade anchor
  const lastYes = await getLastYesPriceBps(eventId);

  let yesBps = yesBest;
  let noBps = noBest;

  if (yesBps == null && noBps == null) {
    yesBps = lastYes;
    noBps = PRICE_SCALE - lastYes;
  } else {
    if (yesBps == null) yesBps = lastYes;
    if (noBps == null) noBps = PRICE_SCALE - lastYes;
  }

  yesBps = clampBps(yesBps);
  noBps = clampBps(noBps);

  return {
    prices: {
      yes: bpsToProb(yesBps),
      no: bpsToProb(noBps),
      yesBps,
      noBps,
    },
    bestBidsBps: { yes: yesBps, no: noBps },
    openOrders,
  };
}





export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const eventId = String(req.query.id || "").trim();
    if (!eventId) return res.status(400).send("event id required");

    const ev = await getEvent(eventId);
    if (!ev) return res.status(404).send("event not found");

    // compute best bids from open orders
    const ids = await kv.smembers(k.ordersByEvent(eventId));
    let yesBest = null;
    let noBest = null;
    let openOrders = 0;

    for (const oid of Array.isArray(ids) ? ids : []) {
      const o = await kv.get(k.order(eventId, oid));
      if (!o || typeof o !== "object") continue;
      if (o.status !== "open") continue;

      const rem = toNum(o.remaining, 0);
      if (rem <= 0) continue;

      openOrders++;

      const pb = clampBps(o.priceBps);
      const oc = String(o.outcome || "").toUpperCase();
      if (oc === "YES") yesBest = yesBest == null ? pb : Math.max(yesBest, pb);
      if (oc === "NO") noBest = noBest == null ? pb : Math.max(noBest, pb);
    }

    // fallback: last trade anchor
    // ✅ 自分の市場情報
const m = await computeMarket(eventId);

// ✅ 親イベントなら children を集める
let children = [];
if (ev.type === "range_parent") {
  const childIds = await kv.smembers(k.childrenByParent(eventId));

  children = await Promise.all(
    (Array.isArray(childIds) ? childIds : []).map(async (cid) => {
      const cev = await getEvent(cid);
      if (!cev) return null;
      const cm = await computeMarket(cid);
      return {
        ...cev,
        prices: cm.prices,
        bestBidsBps: cm.bestBidsBps,
        stats: { ...(cev.stats || {}), openOrders: cm.openOrders },
      };
    })
  );

  children = children.filter(Boolean);
  children.sort((a, b) => toNum(a.rank, 0) - toNum(b.rank, 0));
}

return res.status(200).json({
  ...ev,
  prices: m.prices,
  bestBidsBps: m.bestBidsBps,
  stats: { ...(ev.stats || {}), openOrders: m.openOrders },
  children, // ✅ ここが追加
});

  } catch (e) {
    console.error("events/[id] pm2 error:", e);
    return res.status(500).send(`event read failed: ${e?.message || String(e)}`);
  }
}
