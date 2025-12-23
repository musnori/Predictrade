// api/events/[id]/admin.js
import { kv } from "@vercel/kv";
import { getEvent, getUser, isAdminRequest, k, listUserIds, PMV2 } from "../../_kv.js";

function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("Unauthorized");

    const eventId = String(req.query.id || "").trim();
    if (!eventId) return res.status(400).send("event id required");

    const ev = await getEvent(eventId);
    if (!ev) return res.status(404).send("event not found");

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

    const collKey = `${PMV2}:coll:${eventId}`;
    const collateralUnits = toNum(await kv.get(collKey), 0);
    const payouts = [];
    if (ev.status === "resolved" && ev.result) {
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

    return res.status(200).json({
      ok: true,
      event: { id: ev.id, title: ev.title, status: ev.status, result: ev.result || null },
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
    });
  } catch (e) {
    console.error("events/[id]/admin error:", e);
    return res.status(500).send(`admin event failed: ${e?.message || String(e)}`);
  }
}
