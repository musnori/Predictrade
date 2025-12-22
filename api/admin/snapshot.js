// api/admin/snapshot.js
import { kv } from "@vercel/kv";
import { isAdminRequest, adminSnapshot, listEventIds, listUserIds, k, PMV2, listRulesUpdates, listAuditLogs } from "../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("admin only");

    const base = await adminSnapshot({ includeUsers: true, includeEvents: true });

    // add per-event collateral + counts + orderbook/trades/positions
    const eids = await listEventIds();
    const extras = [];

    for (const eid of eids) {
      const coll = Number((await kv.get(`${PMV2}:coll:${eid}`)) || 0);
      const orderIds = await kv.smembers(k.ordersByEvent(eid));
      const tradeIds = await kv.lrange(k.tradesByEvent(eid), 0, -1).catch(() => []);
      const rulesUpdates = await listRulesUpdates(eid);
      const auditLogs = await listAuditLogs(eid);

      const orders = [];
      for (const oid of Array.isArray(orderIds) ? orderIds : []) {
        const o = await kv.get(k.order(eid, oid));
        if (o && typeof o === "object") orders.push(o);
      }

      const trades = [];
      for (const tid of Array.isArray(tradeIds) ? tradeIds : []) {
        const t = await kv.get(k.trade(eid, tid));
        if (t && typeof t === "object") trades.push(t);
      }

      const positions = [];
      const userIds = await listUserIds();
      for (const uid of userIds) {
        const p = await kv.get(k.position(eid, uid));
        if (p && typeof p === "object") {
          positions.push({ userId: uid, ...p });
        }
      }

      extras.push({
        eventId: eid,
        collateralUnits: coll,
        collateralPoints: coll / 10000,
        ordersCount: Array.isArray(orderIds) ? orderIds.length : 0,
        tradesCount: Array.isArray(tradeIds) ? tradeIds.length : 0,
        rulesUpdates,
        auditLogs,
        orders,
        trades,
        positions,
      });
    }

    return res.status(200).json({ ...base, perEvent: extras });
  } catch (e) {
    console.error("admin/snapshot error:", e);
    return res.status(500).send(`snapshot failed: ${e?.message || String(e)}`);
  }
}
