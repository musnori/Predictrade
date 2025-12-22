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
    const deviceId = String(req.query.deviceId || "").trim();

    const ev = await getEvent(eventId);
    if (!ev) return res.status(404).send("event not found");

    // ✅ 自分の市場情報
    const m = await computeMarketFor(eventId);
    const rulesUpdates = await listRulesUpdates(eventId);
    const tradeIds = await kv.lrange(k.tradesByEvent(eventId), -20, -1).catch(() => []);
    const trades = [];
    for (const tid of Array.isArray(tradeIds) ? tradeIds : []) {
      const t = await kv.get(k.trade(eventId, tid));
      if (t && typeof t === "object") trades.push(t);
    }
    trades.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    let myOpenOrders = null;
    let position = null;
    if (deviceId) {
      const orderIds = await kv.smembers(k.ordersByEvent(eventId));
      const orders = [];
      for (const oid of Array.isArray(orderIds) ? orderIds : []) {
        const o = await kv.get(k.order(eventId, oid));
        if (!o || typeof o !== "object") continue;
        if (o.status !== "open" || toNum(o.remaining, 0) <= 0) continue;
        if (String(o.userId) !== deviceId) continue;
        orders.push({
          id: o.id,
          userId: o.userId,
          side: o.side,
          outcome: o.outcome,
          priceBps: Number(o.priceBps || 0),
          qty: Number(o.qty || 0),
          remaining: Number(o.remaining || 0),
          lockedUnits: Number(o.lockedUnits || 0),
          createdAt: o.createdAt,
        });
      }
      orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      myOpenOrders = orders;

      const p = await kv.get(k.position(eventId, deviceId));
      const obj = p && typeof p === "object" ? p : { yesQty: 0, noQty: 0 };
      position = {
        yesQty: toNum(obj.yesQty, 0),
        noQty: toNum(obj.noQty, 0),
      };
    }

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
      trades,
      myOpenOrders,
      position,
      children,
    });
  } catch (e) {
    console.error("events/[id] pm2 error:", e);
    return res.status(500).send(`event read failed: ${e?.message || String(e)}`);
  }
}
