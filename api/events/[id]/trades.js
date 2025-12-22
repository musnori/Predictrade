import { kv } from "@vercel/kv";
import { getEvent, k } from "../../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const eventId = String(req.query.id || "").trim();
    if (!eventId) return res.status(400).send("event id required");

    const ev = await getEvent(eventId);
    if (!ev) return res.status(404).send("event not found");

    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
    const tradeIds = await kv.lrange(k.tradesByEvent(eventId), -limit, -1).catch(() => []);
    const trades = [];

    for (const tid of Array.isArray(tradeIds) ? tradeIds : []) {
      const t = await kv.get(k.trade(eventId, tid));
      if (!t || typeof t !== "object") continue;
      trades.push(t);
    }

    trades.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return res.status(200).json({ ok: true, trades });
  } catch (e) {
    console.error("trades error:", e);
    return res.status(500).send(`trades failed: ${e?.message || String(e)}`);
  }
}
