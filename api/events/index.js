// api/events/index.js (PM v2) ✅ FULL
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

function clampBps(p) {
  const n = Math.round(toNumber(p, 5000));
  return Math.max(0, Math.min(PRICE_SCALE, n));
}

// Phase1の「現在価格」優先順位:
// 1) best bid (open orders)
// 2) last mint trade
// 3) 0.5
async function getBestBidsBps(eventId) {
  const ids = await kv.smembers(k.ordersByEvent(eventId));
  let yesBest = null;
  let noBest = null;
  let openOrders = 0;

  for (const oid of Array.isArray(ids) ? ids : []) {
    const o = await kv.get(k.order(eventId, oid));
    if (!o || typeof o !== "object") continue;
    if (o.status !== "open") continue;

    const rem = toNumber(o.remaining, 0);
    if (rem <= 0) continue;

    openOrders++;
    const pb = clampBps(o.priceBps);
    const oc = String(o.outcome || "").toUpperCase();

    if (oc === "YES") yesBest = yesBest == null ? pb : Math.max(yesBest, pb);
    if (oc === "NO") noBest = noBest == null ? pb : Math.max(noBest, pb);
  }

  return { yesBest, noBest, openOrders };
}

async function getLastYesPriceBps(eventId) {
  try {
    const tradeIds = await kv.lrange(k.tradesByEvent(eventId), -1, -1); // last 1
    const lastId = Array.isArray(tradeIds) ? tradeIds[0] : null;
    if (!lastId) return 5000;

    const t = await kv.get(k.trade(eventId, lastId));
    if (!t || typeof t !== "object") return 5000;

    return clampBps(t.yesPriceBps);
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
        if (ev.type === "range_child") continue;

        const { yesBest, noBest, openOrders } = await getBestBidsBps(id);

        let yesBps = yesBest;
        let noBps = noBest;

        // fallback to last trade anchor
        if (yesBps == null && noBps == null) {
          const lastYes = await getLastYesPriceBps(id);
          yesBps = lastYes;
          noBps = PRICE_SCALE - lastYes;
        } else {
          // 片側しか板が無い時は、残りは last trade / 0.5 で補完
          const lastYes = await getLastYesPriceBps(id);
          if (yesBps == null) yesBps = lastYes;
          if (noBps == null) noBps = PRICE_SCALE - lastYes;
        }

        yesBps = clampBps(yesBps);
        noBps = clampBps(noBps);

        

        events.push({
          id: ev.id,
          title: ev.title,
          description: ev.description,
          category: ev.category,
          status: ev.status, // active | resolved
          endDate: ev.endDate,
          createdAt: ev.createdAt,

          prices: {
            yes: yesBps / PRICE_SCALE,
            no: noBps / PRICE_SCALE,
            yesBps,
            noBps,
          },

          stats: {
            trades: toNumber(ev?.stats?.trades, 0),
            openOrders: toNumber(ev?.stats?.openOrders, openOrders),
          },

          resolvedAt: ev.resolvedAt || null,
          result: ev.result || null, // "YES" | "NO" | null
        });
      }

      // 期限が近い順（壊れてる日付は最後へ）
      events.sort((a, b) => {
        const ta = new Date(a.endDate).getTime();
        const tb = new Date(b.endDate).getTime();
        const aa = Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER;
        const bb = Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER;
        return aa - bb;
      });

      return res.status(200).json(events);
    }

// -------- POST create (admin only) --------
if (req.method === "POST") {
  if (!isAdminRequest(req))
    return res.status(401).send("admin only (set ADMIN_KEY)");

  const { title, description, category, endDate, ranges } = req.body || {};

  const t = sanitizeText(title, 80);
  const d = sanitizeText(description, 400);
  const c = sanitizeText(category, 30);

  if (!t || !d || !c || !endDate)
    return res.status(400).send("missing fields");

  const end = new Date(endDate).getTime();
  if (!Number.isFinite(end)) return res.status(400).send("invalid endDate");

  // ---------- helper ----------
  const makeBase = (id) => ({
    id,
    title: "",
    description: "",
    category: c,
    status: "active",
    createdAt: nowISO(),
    endDate: new Date(end).toISOString(),
    outcomes: ["YES", "NO"],
    prices: { yesBps: 5000, noBps: 5000 },
    stats: { trades: 0, openOrders: 0 },
    resolvedAt: null,
    result: null,
  });

  // ---------- range market ----------
  if (ranges && typeof ranges === "object") {
    const start = Number(ranges.start);
    const endV = Number(ranges.end);
    const step = Number(ranges.step);

    if (![start, endV, step].every((x) => Number.isFinite(x)))
      return res.status(400).send("invalid ranges (start/end/step)");

    if (step <= 0) return res.status(400).send("step must be > 0");
    if (endV <= start) return res.status(400).send("end must be > start");

    // 親イベント
    const parentId = genId("evt");
    const parent = {
      ...makeBase(parentId),
      title: t,
      description: d,
      type: "range_parent",
      rangeMeta: { start, end: endV, step },
    };

    await putEvent(parent);

    // 子イベント生成
    const children = [];
    for (let lo = start; lo < endV; lo += step) {
      const hi = lo + step;
      if (hi > endV) break;

      const childId = genId("evt");
      const childTitle = `${t}（${lo}〜${hi}）`;
      const childDesc =
        `${d}\n\n判定：${lo}以上${hi}未満なら「YES」、それ以外は「NO」。`;

      const child = {
        ...makeBase(childId),
        title: sanitizeText(childTitle, 80),
        description: sanitizeText(childDesc, 400),
        type: "range_child",
        parentId,
        range: { lo, hi },
      };

      await putEvent(child);
      children.push(childId);
    }

    // 親に子ID一覧を持たせておく（後で親ページを作る時に便利）
    parent.children = children;
    await putEvent(parent);

    return res.status(200).json({
      ok: true,
      mode: "range",
      parent,
      children,
    });
  }

  // ---------- normal (single) ----------
  const eventId = genId("evt");
  const ev = {
    ...makeBase(eventId),
    title: t,
    description: d,
    type: "single",
  };

  await putEvent(ev);
  return res.status(200).json({ ok: true, mode: "single", event: ev });
}


    return res.status(405).send("Method Not Allowed");
  } catch (e) {
    console.error("events/index error:", e);
    return res.status(500).send(`events index failed: ${e?.message || String(e)}`);
  }
}
