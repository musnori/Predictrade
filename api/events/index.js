// api/events/index.js (PM v2) ✅ FULL
import {
  isAdminRequest,
  sanitizeText,
  nowISO,
  genId,
  putEvent,
  listEventIds,
  getEvent,
  PRICE_SCALE,
  listRulesUpdates,
} from "../_kv.js";
import { computeOrderbook, computeDisplayPrice, getLastTrade } from "../_market.js";

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampBps(p) {
  const n = Math.round(toNumber(p, 5000));
  return Math.max(0, Math.min(PRICE_SCALE, n));
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

        const orderbook = await computeOrderbook(id);
        const lastTrade = await getLastTrade(id);
        const display = computeDisplayPrice(orderbook, lastTrade);

        
        const rulesUpdates = await listRulesUpdates(id);

        const endTime = new Date(ev.endDate).getTime();
        const status =
          ev.status === "active" && Number.isFinite(endTime) && Date.now() >= endTime
            ? "tradingClosed"
            : ev.status;

        events.push({
          id: ev.id,
          title: ev.title,
          description: ev.description,
          rules: ev.rules,
          resolutionSource: ev.resolutionSource,
          category: ev.category,
          status, // active | tradingClosed | resolved | canceled
          endDate: ev.endDate,
          createdAt: ev.createdAt,
          rulesUpdates,

          prices: {
            yes: display.displayYesBps / PRICE_SCALE,
            no: display.displayNoBps / PRICE_SCALE,
            yesBps: display.displayYesBps,
            noBps: display.displayNoBps,
            midpointYesBps: display.midpointYesBps,
            spreadYesBps: display.spreadYesBps,
            source: display.source,
          },

          stats: {
            trades: toNumber(ev?.stats?.trades, 0),
            openOrders: toNumber(ev?.stats?.openOrders, orderbook.openOrders),
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

  const { title, description, rules, resolutionSource, category, endDate, ranges } = req.body || {};

  const t = sanitizeText(title, 80);
  const d = sanitizeText(description, 400);
  const r = sanitizeText(rules, 1200);
  const src = sanitizeText(resolutionSource, 200);
  const c = sanitizeText(category, 30);

  if (!t || !d || !r || !src || !c || !endDate)
    return res.status(400).send("missing fields");

  const end = new Date(endDate).getTime();
  if (!Number.isFinite(end)) return res.status(400).send("invalid endDate");

  // ---------- helper ----------
  const makeBase = (id) => ({
    id,
    title: "",
    description: "",
    rules: r,
    resolutionSource: src,
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
        rules: sanitizeText(`${r}\n\n${childDesc}`, 1200),
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
