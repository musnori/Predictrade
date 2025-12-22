// api/events/[id]/orders.js
import { kv } from "@vercel/kv";
import { withLock, getEvent, k } from "../../../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const eventId = String(req.query.id || "").trim();
    if (!eventId) return res.status(400).send("event id required");

    // event exists check（軽く）
    const ev = await getEvent(eventId);
    if (!ev) return res.status(404).send("event not found");

    const deviceId = String(req.query.deviceId || "").trim(); // optional

    // orders set -> fetch
    const ids = await kv.smembers(k.ordersByEvent(eventId));
    const out = [];

    for (const oid of Array.isArray(ids) ? ids : []) {
      const o = await kv.get(k.order(eventId, oid));
      if (!o || typeof o !== "object") continue;

      // open & remaining only
      const remaining = Number(o.remaining || 0);
      if (o.status !== "open" || remaining <= 0) continue;

      if (deviceId && String(o.userId) !== deviceId) continue;

      out.push({
        id: o.id,
        userId: o.userId,
        side: o.side,
        outcome: o.outcome,
        priceBps: Number(o.priceBps || 0),
        qty: Number(o.qty || 0),
        remaining,
        lockedUnits: Number(o.lockedUnits || 0),
        createdAt: o.createdAt,
      });
    }

    // 新しい順
    out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({ ok: true, orders: out });
  } catch (e) {
    console.error("orders/index error:", e);
    return res.status(500).send(`orders list failed: ${e?.message || String(e)}`);
  }
}
