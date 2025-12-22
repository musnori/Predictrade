// api/events/[id]/predict.js  (PM v2 - Phase1: Buy orders + Mint on match)
import {
  ensureUser,
  withLock,
  getEvent,
  putEvent,
  k,
  genId,
  nowISO,
  sanitizeText,
  clampPriceBps,
  PRICE_SCALE,
  appendAuditLog,
} from "../../_kv.js";
import { kv } from "@vercel/kv";

// 追加：collateral のキー接頭辞
const PMV2_PREFIX = "predictrade:pm:v2";

/**
 * Phase1仕様:
 * - outcome: "YES" | "NO"
 * - side: "buy" のみ対応（売却はPhase2）
 * - priceBps: 0..10000
 * - qty: integer shares (>0)
 *
 * Polymarket的「発行」:
 * - YES買い(p) と NO買い(p_no) があり、p + p_no >= 1 なら
 *   YESは p、NOは (1-p) で合意として発行し、合計1担保で mint
 *
 * 残高:
 * - units（1ポイント=10000 units）
 * - YESを pBps で qty 買う → (pBps*qty) units をロック
 * - 約定するとロック分を消費し、ポジションが増える
 */

// ---- helpers (units) ----
const UNIT_SCALE = PRICE_SCALE; // 10000 units = 1 point

function assertOutcome(v) {
  const x = String(v || "").toUpperCase();
  if (x !== "YES" && x !== "NO") throw new Error("invalid_outcome");
  return x;
}

function assertSide(v) {
  const x = String(v || "").toLowerCase();
  if (x !== "buy" && x !== "sell") throw new Error("side must be buy or sell");
  return x;
}

function assertQty(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) throw new Error("qty must be > 0");
  if (n > 5000) throw new Error("qty too large (<=5000)"); // safety
  return n;
}

function oppOutcome(outcome) {
  return outcome === "YES" ? "NO" : "YES";
}

function costUnits(priceBps, qty) {
  // priceBps(0..10000) * qty => units
  return Number(priceBps) * Number(qty);
}

// balance helpers (units) - implemented inline to avoid depending on older point-based functions
async function getBalUnits(userId) {
  const b = await kv.get(k.balance(userId));
  const obj = b && typeof b === "object" ? b : { available: 0, locked: 0 };
  return { available: Number(obj.available || 0), locked: Number(obj.locked || 0) };
}

async function setBalUnits(userId, available, locked) {
  const a = Number(available || 0);
  const l = Number(locked || 0);
  if (a < 0 || l < 0) throw new Error("negative_balance");
  await kv.set(k.balance(userId), { available: a, locked: l, updatedAt: nowISO() });
  return { available: a, locked: l };
}

async function lockUnits(userId, units) {
  const u = Number(units || 0);
  if (!Number.isFinite(u) || u <= 0) throw new Error("invalid_lock_units");
  return await withLock(`bal:${userId}`, async () => {
    const cur = await getBalUnits(userId);
    if (cur.available < u) throw new Error("not enough points");
    return await setBalUnits(userId, cur.available - u, cur.locked + u);
  });
}

async function spendLockedUnits(userId, unitsSpent, refundUnits = 0) {
  // lockedから消費し、必要ならrefundをavailableへ戻す
  const s = Number(unitsSpent || 0);
  const r = Number(refundUnits || 0);
  return await withLock(`bal:${userId}`, async () => {
    const cur = await getBalUnits(userId);
    if (cur.locked < s + r) throw new Error("insufficient_locked");
    return await setBalUnits(userId, cur.available + r, cur.locked - s - r);
  });
}

// positions: { yesQty, noQty }
async function getPos(eventId, userId) {
  const p = await kv.get(k.position(eventId, userId));
  const obj = p && typeof p === "object" ? p : { yesQty: 0, noQty: 0 };
  return { yesQty: Number(obj.yesQty || 0), noQty: Number(obj.noQty || 0) };
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

async function removePos(eventId, userId, outcome, qty) {
  return await withLock(`pos:${eventId}:${userId}`, async () => {
    const cur = await getPos(eventId, userId);
    const next =
      outcome === "YES"
        ? { yesQty: cur.yesQty - qty, noQty: cur.noQty }
        : { yesQty: cur.yesQty, noQty: cur.noQty - qty };
    if (next.yesQty < 0 || next.noQty < 0) throw new Error("insufficient_shares");
    await kv.set(k.position(eventId, userId), next);
    return next;
  });
}

async function addAvailableUnits(userId, units) {
  const u = Number(units || 0);
  if (!Number.isFinite(u) || u < 0) throw new Error("invalid_units");
  return await withLock(`bal:${userId}`, async () => {
    const cur = await getBalUnits(userId);
    return await setBalUnits(userId, cur.available + u, cur.locked);
  });
}

// orders store: { id, userId, outcome, priceBps, qty, remaining, lockedUnits, createdAt, status }
async function putOrder(eventId, order) {
  await kv.set(k.order(eventId, order.id), order);
  await kv.sadd(k.ordersByEvent(eventId), order.id);
}

async function listOpenOrders(eventId) {
  const ids = await kv.smembers(k.ordersByEvent(eventId));
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const o = await kv.get(k.order(eventId, id));
    if (!o || typeof o !== "object") continue;
    if (o.status === "open" && Number(o.remaining || 0) > 0) out.push(o);
  }
  return out;
}

async function closeOrder(eventId, orderId, patch = {}) {
  const key = k.order(eventId, orderId);
  const cur = await kv.get(key);
  if (!cur || typeof cur !== "object") return null;
  const next = { ...cur, ...patch, updatedAt: nowISO() };
  await kv.set(key, next);
  return next;
}

// trades
async function addTrade(eventId, trade) {
  const tradeId = trade.id || genId("trd");
  const t = { ...trade, id: tradeId, createdAt: nowISO() };
  await kv.set(k.trade(eventId, tradeId), t);
  await kv.rpush(k.tradesByEvent(eventId), tradeId); // list
  return t;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const eventId = String(req.query.id || "");
    if (!eventId) return res.status(400).send("event id required");

    const { deviceId, name, outcome, side, priceBps, qty } = req.body || {};
    if (!deviceId) return res.status(400).send("deviceId required");

    const oc = assertOutcome(outcome);
    const orderSide = assertSide(side);
    const pBps = clampPriceBps(priceBps);
    const q = assertQty(qty);

    // イベントロック（同時に約定処理すると壊れるので直列化）
    const result = await withLock(`evt:${eventId}`, async () => {
      // event check
      const ev = await getEvent(eventId);
      if (!ev) throw new Error("event not found");
      if (ev.status === "resolved" || ev.status === "canceled") throw new Error("event already resolved");

      const end = new Date(ev.endDate).getTime();
      if (Number.isFinite(end) && Date.now() >= end) {
        if (ev.status === "active") {
          await putEvent({ ...ev, status: "tradingClosed", updatedAt: nowISO() });
        }
        throw new Error("event closed");
      }

      // ensure user & balance
      await ensureUser(deviceId, sanitizeText(name || "Guest", 32));

      let locked = 0;
      if (orderSide === "buy") {
        locked = costUnits(pBps, q);
        await lockUnits(deviceId, locked);
      } else {
        await removePos(eventId, deviceId, oc, q);
      }

      const orderId = genId("ord");
      const order = {
        id: orderId,
        eventId,
        userId: deviceId,
        outcome: oc,
        side: orderSide,
        priceBps: pBps,
        qty: q,
        remaining: q,
        lockedUnits: locked,
        lockedShares: orderSide === "sell" ? q : 0,
        status: "open",
        createdAt: nowISO(),
      };
      await putOrder(eventId, order);

      const opp = oppOutcome(oc);
      const opens = await listOpenOrders(eventId);

      let remaining = q;
      let totalFilled = 0;

      if (orderSide === "buy") {
        // 1) match against SELL orders (secondary trades)
        const sellCandidates = opens
          .filter((o) => o.id !== orderId)
          .filter((o) => o.side === "sell" && o.outcome === oc && o.status === "open")
          .filter((o) => Number(o.priceBps) <= pBps)
          .sort((a, b) => Number(a.priceBps) - Number(b.priceBps));

        for (const maker of sellCandidates) {
          if (remaining <= 0) break;
          const makerRem = Number(maker.remaining || 0);
          if (makerRem <= 0) continue;

          const fillQty = Math.min(remaining, makerRem);
          const execPrice = Number(maker.priceBps);
          const buyerSpend = costUnits(execPrice, fillQty);
          const buyerRefund = costUnits(pBps - execPrice, fillQty);

          remaining -= fillQty;
          totalFilled += fillQty;

          const newMakerRem = makerRem - fillQty;
          await closeOrder(eventId, maker.id, {
            remaining: newMakerRem,
            lockedShares: newMakerRem <= 0 ? 0 : newMakerRem,
            status: newMakerRem <= 0 ? "filled" : "open",
          });

          await closeOrder(eventId, orderId, {
            remaining,
            lockedUnits: remaining <= 0 ? 0 : costUnits(pBps, remaining),
            status: remaining <= 0 ? "filled" : "open",
          });

          await addPos(eventId, deviceId, oc, fillQty);
          await spendLockedUnits(deviceId, buyerSpend, buyerRefund);
          await addAvailableUnits(maker.userId, buyerSpend);

          await addTrade(eventId, {
            eventId,
            qty: fillQty,
            yesPriceBps: oc === "YES" ? execPrice : PRICE_SCALE - execPrice,
            noPriceBps: oc === "NO" ? execPrice : PRICE_SCALE - execPrice,
            taker: { userId: deviceId, outcome: oc, priceBps: execPrice },
            maker: { userId: maker.userId, outcome: oc, priceBps: execPrice, orderId: maker.id },
            kind: "secondary",
          });
        }

        // 2) match against opposite BUY orders to MINT
        if (remaining > 0) {
          const needOppMin = PRICE_SCALE - pBps;
          const mintCandidates = opens
            .filter((o) => o.id !== orderId)
            .filter((o) => o.side === "buy" && o.outcome === opp && o.status === "open")
            .filter((o) => Number(o.priceBps) >= needOppMin)
            .sort((a, b) => Number(b.priceBps) - Number(a.priceBps));

          for (const maker of mintCandidates) {
            if (remaining <= 0) break;
            const makerRem = Number(maker.remaining || 0);
            if (makerRem <= 0) continue;

            const fillQty = Math.min(remaining, makerRem);
            const takerPrice = pBps;
            const makerExecPrice = PRICE_SCALE - takerPrice;

            if (makerExecPrice > Number(maker.priceBps)) continue;

            const takerSpend = costUnits(takerPrice, fillQty);
            const makerSpend = costUnits(makerExecPrice, fillQty);
            const makerRefund =
              costUnits(Number(maker.priceBps) - makerExecPrice, fillQty);

            remaining -= fillQty;
            totalFilled += fillQty;

            const newMakerRem = makerRem - fillQty;

            await closeOrder(eventId, maker.id, {
              remaining: newMakerRem,
              lockedUnits:
                newMakerRem <= 0 ? 0 : costUnits(Number(maker.priceBps), newMakerRem),
              status: newMakerRem <= 0 ? "filled" : "open",
            });

            await closeOrder(eventId, orderId, {
              remaining,
              lockedUnits: remaining <= 0 ? 0 : costUnits(pBps, remaining),
              status: remaining <= 0 ? "filled" : "open",
            });

            await addPos(eventId, deviceId, oc, fillQty);
            await addPos(eventId, maker.userId, opp, fillQty);

            await kv.incrby(`${PMV2_PREFIX}:coll:${eventId}`, fillQty * UNIT_SCALE);

            await spendLockedUnits(deviceId, takerSpend, 0);
            await spendLockedUnits(maker.userId, makerSpend, makerRefund);

            await addTrade(eventId, {
              eventId,
              qty: fillQty,
              yesPriceBps: oc === "YES" ? takerPrice : makerExecPrice,
              noPriceBps: oc === "NO" ? takerPrice : makerExecPrice,
              taker: { userId: deviceId, outcome: oc, priceBps: takerPrice },
              maker: { userId: maker.userId, outcome: opp, priceBps: makerExecPrice, orderId: maker.id },
              kind: "mint",
            });
          }
        }
      } else {
        // SELL order: match with existing BUY orders (secondary trades)
        const buyCandidates = opens
          .filter((o) => o.id !== orderId)
          .filter((o) => o.side === "buy" && o.outcome === oc && o.status === "open")
          .filter((o) => Number(o.priceBps) >= pBps)
          .sort((a, b) => Number(b.priceBps) - Number(a.priceBps));

        for (const maker of buyCandidates) {
          if (remaining <= 0) break;
          const makerRem = Number(maker.remaining || 0);
          if (makerRem <= 0) continue;

          const fillQty = Math.min(remaining, makerRem);
          const execPrice = Number(maker.priceBps);
          const buyerSpend = costUnits(execPrice, fillQty);

          remaining -= fillQty;
          totalFilled += fillQty;

          const newMakerRem = makerRem - fillQty;
          await closeOrder(eventId, maker.id, {
            remaining: newMakerRem,
            lockedUnits:
              newMakerRem <= 0 ? 0 : costUnits(Number(maker.priceBps), newMakerRem),
            status: newMakerRem <= 0 ? "filled" : "open",
          });

          await closeOrder(eventId, orderId, {
            remaining,
            lockedShares: remaining <= 0 ? 0 : remaining,
            status: remaining <= 0 ? "filled" : "open",
          });

          await addPos(eventId, maker.userId, oc, fillQty);
          await spendLockedUnits(maker.userId, buyerSpend, 0);
          await addAvailableUnits(deviceId, buyerSpend);

          await addTrade(eventId, {
            eventId,
            qty: fillQty,
            yesPriceBps: oc === "YES" ? execPrice : PRICE_SCALE - execPrice,
            noPriceBps: oc === "NO" ? execPrice : PRICE_SCALE - execPrice,
            taker: { userId: deviceId, outcome: oc, priceBps: execPrice },
            maker: { userId: maker.userId, outcome: oc, priceBps: execPrice, orderId: maker.id },
            kind: "secondary",
          });
        }
      }

      // If order fully filled, refund any unused locked due to improvement:
      // lockedUnits was pLimit*qty; actually spent pExec*filled + (for remaining open part we keep locked)
      // In this Phase1 matching, execution = limit price for taker, so no refund on taker fills.
      // But if we later add price improvement, handle refunds here.

      // Update event stats / snapshots (simple)
      const tradesCount = await kv.llen(k.tradesByEvent(eventId));
      const openOrders = (await listOpenOrders(eventId)).length;

      const ev2 = {
        ...ev,
        updatedAt: nowISO(),
        stats: {
          ...(ev.stats || {}),
          trades: tradesCount,
          openOrders,
        },
      };
      await putEvent(ev2);

      const bal = await getBalUnits(deviceId);
      const pos = await getPos(eventId, deviceId);

      await appendAuditLog(eventId, {
        at: nowISO(),
        type: "order",
        by: deviceId,
        side: orderSide,
        outcome: oc,
        priceBps: pBps,
        qty: q,
        filled: totalFilled,
      });

      return {
        ok: true,
        event: ev2,
        order: await kv.get(k.order(eventId, orderId)),
        filled: totalFilled,
        remaining,
        balanceUnits: bal,
        position: pos,
      };
    });

    return res.status(200).json(result);
  } catch (e) {
    console.error("predict(pm2) error:", e);
    const msg = e?.message || String(e);
    const code =
      msg.startsWith("lock_busy") ? 409 :
      msg.includes("not found") ? 404 :
      msg.includes("closed") ? 400 :
      msg.includes("already resolved") ? 400 :
      msg.includes("not enough") ? 400 :
      msg.includes("insufficient_shares") ? 400 :
      500;
    return res.status(code).send(msg);
  }
}
