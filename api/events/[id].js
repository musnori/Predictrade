// api/events/[id].js (PM v2)
import { kv } from "@vercel/kv";
import { getEvent, k, PRICE_SCALE, bpsToProb } from "../_kv.js";

function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
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

      const rem = toNum(o.remaining);
      if (rem <= 0) continue;

      openOrders++;

      const pb = toNum(o.priceBps);
      if (String(o.outcome).toUpperCase() === "YES") yesBest = yesBest == null ? pb : Math.max(yesBest, pb);
      if (String(o.outcome).toUpperCase() === "NO") noBest = noBest == null ? pb : Math.max(noBest, pb);
    }

    const yesBps = yesBest == null ? PRICE_SCALE / 2 : yesBest;
    const noBps = noBest == null ? PRICE_SCALE / 2 : noBest;

    return res.status(200).json({
      ...ev,
      prices: {
        yes: bpsToProb(yesBps),
        no: bpsToProb(noBps),
      },
      bestBidsBps: { yes: yesBps, no: noBps },
      stats: { ...(ev.stats || {}), openOrders },
    });
  } catch (e) {
    console.error("events/[id] pm2 error:", e);
    return res.status(500).send(`event read failed: ${e?.message || String(e)}`);
  }
}
