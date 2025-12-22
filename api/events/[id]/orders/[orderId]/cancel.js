// api/events/[id]/orders/[orderId]/cancel.js  (PM v2)
import { kv } from "@vercel/kv";
import { withLock, getEvent, putEvent, k, nowISO, PRICE_SCALE } from "../../../../_kv.js";

function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

async function getBal(userId) {
  const b = await kv.get(k.balance(userId));
  const obj = b && typeof b === "object" ? b : { available: 0, locked: 0 };
  return { available: toNum(obj.available), locked: toNum(obj.locked) };
}

async function setBal(userId, available, locked) {
  const a = toNum(available);
  const l = toNum(locked);
  if (a < 0 || l < 0) throw new Error("negative_balance");
  await kv.set(k.balance(userId), { available: a, locked: l, updatedAt: nowISO() });
  return { available: a, locked: l };
}

async function getPos(eventId, userId) {
  const p = await kv.get(k.position(eventId, userId));
  const obj = p && typeof p === "object" ? p : { yesQty: 0, noQty: 0 };
  return { yesQty: toNum(obj.yesQty), noQty: toNum(obj.noQty) };
}

async function addPos(eventId, userId, outcome, qty) {
  return await withLock(`pos:${eventId}:${userId}`, async () => {
    const cur = await getPos(eventId, userId);
    const next =
      outcome === "YES"
        ? { yesQty: cur.yesQty + qty, noQty: cur.noQty }
        : { yesQty: cur.yesQty, noQty: cur.noQty + qty };
    await kv.set(k.position(eventId, userId), next);
    return next;
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const eventId = String(req.query.id || "").trim();
    const orderId = String(req.query.orderId || "").trim();
    if (!eventId || !orderId) return res.status(400).send("event id & orderId required");

    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).send("deviceId required");

    const out = await withLock(`evt:${eventId}`, async () => {
      const ev = await getEvent(eventId);
      if (!ev) throw new Error("event not found");
      if (ev.status === "resolved") throw new Error("event already resolved");

      const key = k.order(eventId, orderId);
      const ord = await kv.get(key);
      if (!ord || typeof ord !== "object") throw new Error("order not found");

      if (String(ord.userId) !== String(deviceId)) throw new Error("forbidden");
      if (ord.status !== "open") throw new Error("order not open");

      const remaining = toNum(ord.remaining);
      if (remaining <= 0) throw new Error("nothing to cancel");

      const priceBps = toNum(ord.priceBps);
      if (priceBps < 0 || priceBps > PRICE_SCALE) throw new Error("invalid order price");

      let bal = null;
      let refundUnits = 0;
      if (ord.side === "buy") {
        // ✅ 返金は「orderに残っている lockedUnits」を信頼する（remaining*priceBpsの再計算はしない）
        refundUnits = Math.floor(toNum(ord.lockedUnits));
        if (refundUnits <= 0) throw new Error("nothing_to_refund");

        // balance: locked -> available へ戻す
        bal = await withLock(`bal:${deviceId}`, async () => {
          const cur = await getBal(deviceId);
          if (cur.locked < refundUnits) {
            throw new Error(`insufficient_locked: have=${cur.locked} need=${refundUnits}`);
          }
          return setBal(deviceId, cur.available + refundUnits, cur.locked - refundUnits);
        });
      } else if (ord.side === "sell") {
        const remainingShares = toNum(ord.remaining);
        if (remainingShares > 0) {
          await addPos(eventId, deviceId, String(ord.outcome || "").toUpperCase(), remainingShares);
        }
      }

      // order をキャンセルに（remaining=0, lockedUnits=0）
      const next = {
        ...ord,
        status: "cancelled",
        cancelledAt: nowISO(),
        remaining: 0,
        lockedUnits: 0,
        updatedAt: nowISO(),
      };
      await kv.set(key, next);

      // event stats 更新（openOrders）
      const ids = await kv.smembers(k.ordersByEvent(eventId));
      let openOrders = 0;
      for (const oid of Array.isArray(ids) ? ids : []) {
        const o = await kv.get(k.order(eventId, oid));
        if (o && typeof o === "object" && o.status === "open" && toNum(o.remaining) > 0) openOrders++;
      }
      const ev2 = {
        ...ev,
        updatedAt: nowISO(),
        stats: { ...(ev.stats || {}), openOrders },
      };
      await putEvent(ev2);

      return { ok: true, order: next, balanceUnits: bal, event: ev2, refundUnits: bal ? refundUnits : 0 };
    });

    return res.status(200).json(out);
  } catch (e) {
    console.error("orders/cancel error:", e);
    const msg = e?.message || String(e);
    const code =
      msg.includes("forbidden") ? 403 :
      msg.includes("not found") ? 404 :
      msg.includes("already resolved") ? 400 :
      msg.includes("not open") ? 400 :
      msg.includes("nothing to cancel") ? 400 :
      msg.includes("nothing_to_refund") ? 400 :
      msg.includes("insufficient_locked") ? 409 :
      500;
    return res.status(code).send(msg);
  }
}
