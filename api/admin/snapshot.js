// api/admin/snapshot.js
import { kv } from "@vercel/kv";
import { isAdminRequest, adminSnapshot, listEventIds, k, PMV2 } from "../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("admin only");

    const base = await adminSnapshot({ includeUsers: true, includeEvents: true });

    // add per-event collateral + counts
    const eids = await listEventIds();
    const extras = [];

    for (const eid of eids) {
      const coll = Number((await kv.get(`${PMV2}:coll:${eid}`)) || 0);
      const orderIds = await kv.smembers(k.ordersByEvent(eid));
      const tradeIds = await kv.lrange(k.tradesByEvent(eid), 0, -1).catch(() => []);
      extras.push({
        eventId: eid,
        collateralUnits: coll,
        collateralPoints: coll / 10000,
        ordersCount: Array.isArray(orderIds) ? orderIds.length : 0,
        tradesCount: Array.isArray(tradeIds) ? tradeIds.length : 0,
      });
    }

    return res.status(200).json({ ...base, perEvent: extras });
  } catch (e) {
    console.error("admin/snapshot error:", e);
    return res.status(500).send(`snapshot failed: ${e?.message || String(e)}`);
  }
}
