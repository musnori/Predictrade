// api/events/[id].js (PM v2) ✅ FIXED FULL
import { kv } from "@vercel/kv";
import { getEvent, k, PRICE_SCALE, bpsToProb, listRulesUpdates } from "../_kv.js";
import { computeOrderbook, computeDisplayPrice, getLastTrade } from "../_market.js";

function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clampBps(v) {
  const n = Math.round(toNum(v, PRICE_SCALE / 2));
  return Math.max(0, Math.min(PRICE_SCALE, n));
}

async function computeMarketFor(eventId) {
  const orderbook = await computeOrderbook(eventId);
  const lastTrade = await getLastTrade(eventId);
  const display = computeDisplayPrice(orderbook, lastTrade);

  return {
    prices: {
      yes: bpsToProb(display.displayYesBps),
      no: bpsToProb(display.displayNoBps),
      yesBps: display.displayYesBps,
      noBps: display.displayNoBps,
      midpointYesBps: display.midpointYesBps,
      spreadYesBps: display.spreadYesBps,
      source: display.source,
    },
    bestBidsBps: {
      yes: orderbook.yes.bestBidBps,
      no: orderbook.no.bestBidBps,
    },
    bestAsksBps: {
      yes: orderbook.yes.bestAskBps,
      no: orderbook.no.bestAskBps,
    },
    lastTrade,
    orderbook,
    openOrders: orderbook.openOrders,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const eventId = String(req.query.id || "").trim();
    if (!eventId) return res.status(400).send("event id required");

    const ev = await getEvent(eventId);
    if (!ev) return res.status(404).send("event not found");

    // ✅ 自分の市場情報
    const m = await computeMarketFor(eventId);
    const rulesUpdates = await listRulesUpdates(eventId);

    // ✅ 親イベントなら children を集める
    let children = [];
    if (ev.type === "range_parent") {
      const childIds = await kv.smembers(k.childrenByParent(eventId));

      children = await Promise.all(
        (Array.isArray(childIds) ? childIds : []).map(async (cid) => {
          const cev = await getEvent(cid);
          if (!cev) return null;
          const cm = await computeMarketFor(cid);
          const childEnd = new Date(cev.endDate).getTime();
          const childStatus =
            cev.status === "active" && Number.isFinite(childEnd) && Date.now() >= childEnd
              ? "tradingClosed"
              : cev.status;
          return {
            ...cev,
            status: childStatus,
            prices: cm.prices,
            bestBidsBps: cm.bestBidsBps,
            bestAsksBps: cm.bestAsksBps,
            orderbook: cm.orderbook,
            stats: { ...(cev.stats || {}), openOrders: cm.openOrders },
          };
        })
      );

      children = children.filter(Boolean);
      children.sort((a, b) => toNum(a.rank, 0) - toNum(b.rank, 0));
    }

    const endTime = new Date(ev.endDate).getTime();
    const status =
      ev.status === "active" && Number.isFinite(endTime) && Date.now() >= endTime
        ? "tradingClosed"
        : ev.status;

    return res.status(200).json({
      ...ev,
      status,
      prices: m.prices,
      bestBidsBps: m.bestBidsBps,
      bestAsksBps: m.bestAsksBps,
      lastTrade: m.lastTrade,
      orderbook: m.orderbook,
      stats: { ...(ev.stats || {}), openOrders: m.openOrders },
      rulesUpdates,
      children,
    });
  } catch (e) {
    console.error("events/[id] pm2 error:", e);
    return res.status(500).send(`event read failed: ${e?.message || String(e)}`);
  }
}
