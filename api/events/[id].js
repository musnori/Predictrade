// api/events/[id].js (PM v2) ✅ FIXED FULL
import { kv } from "@vercel/kv";
import {
  getEvent,
  k,
  bpsToProb,
  listRulesUpdates,
  isAdminRequest,
  withLock,
  listChildEventIds,
  nowISO,
  listUserIds,
  getUser,
  PMV2,
} from "../_kv.js";
import { computeOrderbook, computeDisplayPrice, getLastTrade } from "../_market.js";

function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
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

const PMV2_PREFIX = PMV2;

async function refundOpenOrders(eventId) {
  const orderIds = await kv.smembers(k.ordersByEvent(eventId));
  for (const oid of Array.isArray(orderIds) ? orderIds : []) {
    const ord = await kv.get(k.order(eventId, oid));
    if (!ord || typeof ord !== "object") continue;
    if (ord.status !== "open") continue;
    const remaining = toNum(ord.remaining, 0);
    if (remaining <= 0) continue;

    if (ord.side === "buy") {
      const refundUnits = toNum(ord.lockedUnits, 0);
      if (refundUnits > 0) {
        const balKey = k.balance(ord.userId);
        const cur = await kv.get(balKey);
        const obj = cur && typeof cur === "object" ? cur : { available: 0, locked: 0 };
        const nextAvailable = toNum(obj.available, 0) + refundUnits;
        const nextLocked = Math.max(0, toNum(obj.locked, 0) - refundUnits);
        await kv.set(balKey, { ...obj, available: nextAvailable, locked: nextLocked, updatedAt: nowISO() });
      }
    } else if (ord.side === "sell") {
      const posKey = k.position(eventId, ord.userId);
      const cur = await kv.get(posKey);
      const obj = cur && typeof cur === "object" ? cur : { yesQty: 0, noQty: 0 };
      const addQty = toNum(ord.remaining, 0);
      const outcome = String(ord.outcome || "").toUpperCase();
      const next =
        outcome === "YES"
          ? { yesQty: toNum(obj.yesQty, 0) + addQty, noQty: toNum(obj.noQty, 0) }
          : { yesQty: toNum(obj.yesQty, 0), noQty: toNum(obj.noQty, 0) + addQty };
      await kv.set(posKey, next);
    }

    await kv.set(k.order(eventId, oid), {
      ...ord,
      status: "cancelled",
      remaining: 0,
      lockedUnits: 0,
      lockedShares: 0,
      updatedAt: nowISO(),
    });
  }
}

async function deleteOrdersAndTrades(eventId) {
  const orderIds = await kv.smembers(k.ordersByEvent(eventId));
  for (const oid of Array.isArray(orderIds) ? orderIds : []) {
    await kv.del(k.order(eventId, oid));
  }
  await kv.del(k.ordersByEvent(eventId));

  const tradeIds = await kv.lrange(k.tradesByEvent(eventId), 0, -1).catch(() => []);
  for (const tid of Array.isArray(tradeIds) ? tradeIds : []) {
    await kv.del(k.trade(eventId, tid));
  }
  await kv.del(k.tradesByEvent(eventId));
}

async function deletePositions(eventId) {
  const userIds = await listUserIds();
  for (const uid of Array.isArray(userIds) ? userIds : []) {
    await kv.del(k.position(eventId, uid));
  }
}

async function deleteEventData(eventId) {
  await refundOpenOrders(eventId);
  await deleteOrdersAndTrades(eventId);
  await deletePositions(eventId);
  await kv.del(k.rulesUpdates(eventId));
  await kv.del(k.auditLogs(eventId));
  await kv.del(`${PMV2_PREFIX}:coll:${eventId}`);
  await kv.del(k.event(eventId));
  await kv.srem(k.idxEvents(), eventId);
}

async function computeAdminStats(eventId, ev) {
  const userIds = await listUserIds();
  const userMap = new Map();
  for (const uid of Array.isArray(userIds) ? userIds : []) {
    const user = await getUser(uid);
    if (user) {
      userMap.set(uid, {
        userId: uid,
        name: String(user.displayName || user.name || uid),
      });
    }
  }

  const orderIds = await kv.smembers(k.ordersByEvent(eventId));
  const openOrdersByUser = {};
  let openOrdersCount = 0;
  for (const oid of Array.isArray(orderIds) ? orderIds : []) {
    const ord = await kv.get(k.order(eventId, oid));
    if (!ord || typeof ord !== "object") continue;
    if (ord.status !== "open") continue;
    if (toNum(ord.remaining, 0) <= 0) continue;
    openOrdersCount += 1;
    const uid = String(ord.userId || "");
    if (!uid) continue;
    openOrdersByUser[uid] = (openOrdersByUser[uid] || 0) + 1;
  }

  const tradeIds = await kv.lrange(k.tradesByEvent(eventId), 0, -1).catch(() => []);
  const tradeCountByUser = {};
  for (const tid of Array.isArray(tradeIds) ? tradeIds : []) {
    const t = await kv.get(k.trade(eventId, tid));
    if (!t || typeof t !== "object") continue;
    const takerId = String(t?.taker?.userId || "");
    const makerId = String(t?.maker?.userId || "");
    if (takerId) tradeCountByUser[takerId] = (tradeCountByUser[takerId] || 0) + 1;
    if (makerId) tradeCountByUser[makerId] = (tradeCountByUser[makerId] || 0) + 1;
  }

  const participants = [];
  let totalYes = 0;
  let totalNo = 0;
  for (const uid of Array.isArray(userIds) ? userIds : []) {
    const pos = await kv.get(k.position(eventId, uid));
    const obj = pos && typeof pos === "object" ? pos : { yesQty: 0, noQty: 0 };
    const yesQty = toNum(obj.yesQty, 0);
    const noQty = toNum(obj.noQty, 0);
    const openOrders = toNum(openOrdersByUser[uid], 0);
    const trades = toNum(tradeCountByUser[uid], 0);

    totalYes += yesQty;
    totalNo += noQty;

    if (yesQty > 0 || noQty > 0 || openOrders > 0 || trades > 0) {
      const meta = userMap.get(uid) || { userId: uid, name: uid };
      participants.push({
        userId: uid,
        name: meta.name,
        yesQty,
        noQty,
        openOrders,
        trades,
      });
    }
  }

  participants.sort((a, b) => {
    const aTotal = a.yesQty + a.noQty;
    const bTotal = b.yesQty + b.noQty;
    if (aTotal !== bTotal) return bTotal - aTotal;
    return String(a.name || "").localeCompare(String(b.name || ""), "ja");
  });

  const collKey = `${PMV2_PREFIX}:coll:${eventId}`;
  const collateralUnits = toNum(await kv.get(collKey), 0);
  const payouts = [];
  if (ev?.status === "resolved" && ev?.result) {
    const win = String(ev.result || "").toUpperCase();
    for (const p of participants) {
      const winQty = win === "YES" ? p.yesQty : p.noQty;
      if (winQty <= 0) continue;
      payouts.push({
        userId: p.userId,
        name: p.name,
        winQty,
        paidPoints: winQty,
      });
    }
    payouts.sort((a, b) => b.paidPoints - a.paidPoints);
  }

  return {
    event: { id: ev?.id, title: ev?.title, status: ev?.status, result: ev?.result || null },
    summary: {
      participantsCount: participants.length,
      tradesCount: Array.isArray(tradeIds) ? tradeIds.length : 0,
      openOrdersCount,
      collateralUnits,
      collateralPoints: collateralUnits / 10000,
      yesShares: totalYes,
      noShares: totalNo,
    },
    participants,
    payouts,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      if (!isAdminRequest(req)) return res.status(401).send("Unauthorized");

      const eventId = String(req.query.id || "").trim();
      if (!eventId) return res.status(400).send("event id required");

      const out = await withLock(`evt:${eventId}`, async () => {
        const ev = await getEvent(eventId);
        if (!ev) throw new Error("event not found");

        const ids = ev.type === "range_parent" ? await listChildEventIds(eventId) : [eventId];
        const targetIds = Array.isArray(ids) ? ids : [];

        for (const id of targetIds) {
          await deleteEventData(id);
          await kv.srem(k.childrenByParent(eventId), id);
        }

        if (ev.type === "range_parent") {
          await kv.del(k.childrenByParent(eventId));
          await deleteEventData(eventId);
        }

        return { ok: true, deletedAt: nowISO() };
      });

      return res.status(200).json(out);
    }

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
      children.sort((a, b) => {
        const aLo = toNum(a?.range?.lo, Number.NaN);
        const bLo = toNum(b?.range?.lo, Number.NaN);
        if (Number.isFinite(aLo) && Number.isFinite(bLo) && aLo !== bLo) return aLo - bLo;

        const aHi = toNum(a?.range?.hi, Number.NaN);
        const bHi = toNum(b?.range?.hi, Number.NaN);
        if (Number.isFinite(aHi) && Number.isFinite(bHi) && aHi !== bHi) return aHi - bHi;

        return String(a.title || "").localeCompare(String(b.title || ""), "ja");
      });
    }

    const endTime = new Date(ev.endDate).getTime();
    const status =
      ev.status === "active" && Number.isFinite(endTime) && Date.now() >= endTime
        ? "tradingClosed"
        : ev.status;

    const adminMode = req.query?.admin === "1" && isAdminRequest(req);
    const adminStats = adminMode ? await computeAdminStats(eventId, ev) : null;

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
      adminStats,
    });
  } catch (e) {
    console.error("events/[id] pm2 error:", e);
    const msg = e?.message || String(e);
    if (req.method === "POST") {
      const code =
        msg.includes("Unauthorized") ? 401 :
        msg.includes("event not found") ? 404 :
        500;
      return res.status(code).send(msg);
    }
    return res.status(500).send(`event read failed: ${msg}`);
  }
}
