// api/events/index.js  (PM v2)
import {
  isAdminRequest,
  sanitizeText,
  nowISO,
  genId,
  putEvent,
  listEventIds,
  getEvent,
  k,
  PRICE_SCALE,
} from "../_kv.js";
import { kv } from "@vercel/kv";

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Phase1の「現在価格（YES）」の決め方:
 * - tradesがあれば最後のmint tradeの yesPriceBps を採用
 * - なければ 0.5
 */
async function getLastYesPriceBps(eventId) {
  try {
    const tradeIds = await kv.lrange(k.tradesByEvent(eventId), -1, -1); // last 1
    const lastId = Array.isArray(tradeIds) ? tradeIds[0] : null;
    if (!lastId) return 5000;

    const t = await kv.get(k.trade(eventId, lastId));
    if (!t || typeof t !== "object") return 5000;

    const p = toNumber(t.yesPriceBps, 5000);
    if (p < 0) return 0;
    if (p > PRICE_SCALE) return PRICE_SCALE;
    return Math.round(p);
  } catch {
    return 5000;
  }
}

export default async function handler(req, res) {
  try {
    // -------- GET list --------
    if (req.method === "GET") {
      const ids = await listEventIds();
      const events = [];

      for (const id of ids) {
        const ev = await getEvent(id);
        if (!ev) continue;

        const yesPriceBps =
          typeof ev?.prices?.yesBps === "number"
            ? ev.prices.yesBps
            : await getLastYesPriceBps(id);

        events.push({
          id: ev.id,
          title: ev.title,
          description: ev.description,
          category: ev.category,
          status: ev.status, // active | resolved
          endDate: ev.endDate,
          createdAt: ev.createdAt,

          // Polymarket互換の「価格=確率」
          prices: {
            yes: yesPriceBps / PRICE_SCALE,
            no: (PRICE_SCALE - yesPriceBps) / PRICE_SCALE,
            yesBps: yesPriceBps,
            noBps: PRICE_SCALE - yesPriceBps,
          },

          // 軽い統計（必要なら増やす）
          stats: ev.stats || { trades: 0, openOrders: 0 },

          // 解決情報
          resolvedAt: ev.resolvedAt || null,
          result: ev.result || null, // "YES" | "NO" | null
        });
      }

      // 期限が近い順（任意）
      events.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
      return res.status(200).json(events);
    }

    // -------- POST create (admin only) --------
    if (req.method === "POST") {
      if (!isAdminRequest(req))
        return res.status(401).send("admin only (set ADMIN_KEY)");

      const { title, description, category, endDate } = req.body || {};

      const t = sanitizeText(title, 80);
      const d = sanitizeText(description, 400);
      const c = sanitizeText(category, 30);

      if (!t || !d || !c || !endDate)
        return res.status(400).send("missing fields");

      const end = new Date(endDate).getTime();
      if (!Number.isFinite(end)) return res.status(400).send("invalid endDate");

      const eventId = genId("evt");

      const ev = {
        id: eventId,
        title: t,
        description: d,
        category: c,
        status: "active",
        createdAt: nowISO(),
        endDate: new Date(end).toISOString(),

        // Polymarket風：YES/NO固定
        outcomes: ["YES", "NO"],

        // 初期価格（均等）
        prices: { yesBps: 5000, noBps: 5000 },

        stats: { trades: 0, openOrders: 0 },

        resolvedAt: null,
        result: null,
      };

      await putEvent(ev);
      return res.status(200).json(ev);
    }

    return res.status(405).send("Method Not Allowed");
  } catch (e) {
    console.error("events/index error:", e);
    return res.status(500).send(`events index failed: ${e?.message || String(e)}`);
  }
}
