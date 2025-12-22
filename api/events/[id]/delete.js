// api/events/[id]/delete.js (PM v2)
import { kv } from "@vercel/kv";
import { isAdminRequest, withLock, getEvent, k, listChildEventIds, nowISO } from "../../_kv.js";

const PMV2_PREFIX = "predictrade:pm:v2";

function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

async function countTrades(eventId) {
  const len = await kv.llen(k.tradesByEvent(eventId)).catch(() => 0);
  return toNum(len, 0);
}

async function countOpenOrders(eventId) {
  const ids = await kv.smembers(k.ordersByEvent(eventId));
  let count = 0;
  for (const oid of Array.isArray(ids) ? ids : []) {
    const ord = await kv.get(k.order(eventId, oid));
    if (!ord || typeof ord !== "object") continue;
    if (ord.status !== "open") continue;
    if (toNum(ord.remaining, 0) <= 0) continue;
    count += 1;
  }
  return count;
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

async function deleteEventData(eventId) {
  await deleteOrdersAndTrades(eventId);
  await kv.del(k.rulesUpdates(eventId));
  await kv.del(k.auditLogs(eventId));
  await kv.del(`${PMV2_PREFIX}:coll:${eventId}`);
  await kv.del(k.event(eventId));
  await kv.srem(k.idxEvents(), eventId);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("Unauthorized");

    const eventId = String(req.query.id || "").trim();
    if (!eventId) return res.status(400).send("event id required");

    const out = await withLock(`evt:${eventId}`, async () => {
      const ev = await getEvent(eventId);
      if (!ev) throw new Error("event not found");

      const ids = ev.type === "range_parent" ? await listChildEventIds(eventId) : [eventId];
      const targetIds = Array.isArray(ids) ? ids : [];

      for (const id of targetIds) {
        const tradesCount = await countTrades(id);
        const openOrders = await countOpenOrders(id);
        if (tradesCount > 0 || openOrders > 0) {
          throw new Error("trades_or_orders_exist");
        }
      }

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
  } catch (e) {
    console.error("events/delete error:", e);
    const msg = e?.message || String(e);
    const code =
      msg.includes("Unauthorized") ? 401 :
      msg.includes("event not found") ? 404 :
      msg.includes("trades_or_orders_exist") ? 409 :
      500;
    const text = msg.includes("trades_or_orders_exist")
      ? "取引や注文があるため削除できません"
      : msg;
    return res.status(code).send(text);
  }
}
