// api/users/[deviceId].js (PM v2 history)
import { kv } from "@vercel/kv";
import { getUser, listEventIds, getEvent, k, PRICE_SCALE, listAuditLogs } from "../_kv.js";

function normStr(v) {
  return String(v ?? "");
}

function normalizeUser(u) {
  const user = u && typeof u === "object" ? { ...u } : {};
  user.name = String(user.displayName || user.name || "").trim().slice(0, 20);
  return user;
}

function optionText(outcome) {
  const oc = String(outcome || "").toUpperCase();
  if (oc === "YES") return "YES";
  if (oc === "NO") return "NO";
  return "-";
}

function outcomeLabel(ev, outcome) {
  if (!ev || ev.status !== "resolved") return "未確定";
  const win = String(ev.result || "").toUpperCase();
  const bet = String(outcome || "").toUpperCase();
  if (!win || !bet) return "未確定";
  return win === bet ? "的中" : "ハズレ";
}

function tradeSideForUser(trade, userId) {
  const taker = trade?.taker;
  if (taker && normStr(taker.userId) === normStr(userId)) {
    return { role: "taker", outcome: taker.outcome, priceBps: taker.priceBps };
  }
  const maker = trade?.maker;
  if (maker && normStr(maker.userId) === normStr(userId)) {
    return { role: "maker", outcome: maker.outcome, priceBps: maker.priceBps };
  }
  return null;
}

function costPoints(priceBps, qty) {
  const units = Number(priceBps || 0) * Number(qty || 0);
  return units / PRICE_SCALE;
}

function orderSideLabel(side) {
  const s = String(side || "").toUpperCase();
  if (s === "BUY") return "買い";
  if (s === "SELL") return "売り";
  return "-";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).send("deviceId required");

    const rawUser = await getUser(deviceId);
    if (!rawUser) return res.status(404).send("not found");

    const user = normalizeUser(rawUser);

    // ===== 履歴モード =====
    if (req.query.action === "history") {
      const history = [];

      const eventIds = await listEventIds();

      for (const eventId of eventIds) {
        const ev = await getEvent(eventId);
        if (!ev) continue;

        const tradeIds = await kv.lrange(k.tradesByEvent(eventId), 0, -1).catch(() => []);
        for (const tradeId of Array.isArray(tradeIds) ? tradeIds : []) {
          const t = await kv.get(k.trade(eventId, tradeId));
          if (!t || typeof t !== "object") continue;

          const side = tradeSideForUser(t, deviceId);
          if (!side) continue;

          const qty = Number(t.qty || 0);
          const priceBps = Number(side.priceBps || 0);

          history.push({
            // event
            eventId: ev.id,
            eventTitle: ev.title ?? "-",
            category: ev.category ?? "-",
            endDate: ev.endDate ?? null,
            eventStatus: ev.status ?? "open",
            resultOptionId: ev.result ?? null,

            // trade
            createdAt: t.createdAt ?? null,
            optionId: side.outcome,
            optionText: optionText(side.outcome),
            shares: qty,
            cost: costPoints(priceBps, qty),
            kind: "約定",
            sideLabel: null,

            // status
            outcome: outcomeLabel(ev, side.outcome),
          });
        }

        const auditLogs = await listAuditLogs(eventId);
        for (const log of Array.isArray(auditLogs) ? auditLogs : []) {
          if (!log || typeof log !== "object") continue;
          if (normStr(log.type) !== "order") continue;
          if (normStr(log.by) !== normStr(deviceId)) continue;

          const priceBps = Number(log.priceBps || 0);
          const qty = Number(log.qty || 0);
          const outcome = log.outcome;

          history.push({
            // event
            eventId: ev.id,
            eventTitle: ev.title ?? "-",
            category: ev.category ?? "-",
            endDate: ev.endDate ?? null,
            eventStatus: ev.status ?? "open",
            resultOptionId: ev.result ?? null,

            // order
            createdAt: log.at ?? null,
            optionId: outcome,
            optionText: optionText(outcome),
            shares: qty,
            cost: costPoints(priceBps, qty),
            kind: "注文",
            sideLabel: orderSideLabel(log.side),
            priceBps,

            // status
            outcome: outcomeLabel(ev, outcome),
          });
        }
      }

      history.sort((a, b) => normStr(b.createdAt).localeCompare(normStr(a.createdAt)));

      return res.status(200).json({
        ok: true,
        user,
        history,
        count: history.length,
      });
    }

    // ===== 通常：統一形式で返す =====
    return res.status(200).json({ ok: true, user });
  } catch (e) {
    console.error("users/[deviceId] error:", e);
    return res.status(500).send(`users api failed: ${e?.message || String(e)}`);
  }
}
