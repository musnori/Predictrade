// api/events/[id]/resolve.js (PM v2)
import { kv } from "@vercel/kv";
import { isAdminRequest, withLock, getEvent, putEvent, listUserIds, k, nowISO, PRICE_SCALE } from "../../_kv.js";

const PMV2_PREFIX = "predictrade:pm:v2";
const UNIT_SCALE = PRICE_SCALE; // 10000

function assertResult(v) {
  const x = String(v || "").toUpperCase();
  if (x !== "YES" && x !== "NO") throw new Error("result must be YES or NO");
  return x;
}

function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

async function getPos(eventId, userId) {
  const p = await kv.get(k.position(eventId, userId));
  const obj = p && typeof p === "object" ? p : { yesQty: 0, noQty: 0 };
  return { yesQty: toNum(obj.yesQty), noQty: toNum(obj.noQty) };
}

async function getBal(userId) {
  const b = await kv.get(k.balance(userId));
  const obj = b && typeof b === "object" ? b : { available: 0, locked: 0 };
  return { available: toNum(obj.available), locked: toNum(obj.locked) };
}

async function setBal(userId, available, locked) {
  const a = toNum(available);
  const l = toNum(locked);
  if (a < 0 || l < 0) throw new Error("negative_balance");
  await kv.set(k.balance(userId), { available: a, locked: l, updatedAt: nowISO() });
  return { available: a, locked: l };
}

async function addAvailable(userId, units) {
  const u = toNum(units);
  return await withLock(`bal:${userId}`, async () => {
    const cur = await getBal(userId);
    return await setBal(userId, cur.available + u, cur.locked);
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("Unauthorized");

    const eventId = String(req.query.id || "").trim();
    if (!eventId) return res.status(400).send("event id required");

    const win = assertResult(req.body?.result);

    const out = await withLock(`evt:${eventId}`, async () => {
      const ev = await getEvent(eventId);
      if (!ev) throw new Error("event not found");
      if (ev.status === "resolved") throw new Error("event already resolved");

      const collKey = `${PMV2_PREFIX}:coll:${eventId}`;
      const collBefore = toNum(await kv.get(collKey), 0);

      const userIds = await listUserIds();
      const payouts = [];
      let payTotal = 0;

      for (const uid of userIds) {
        const pos = await getPos(eventId, uid);
        const winQty = win === "YES" ? pos.yesQty : pos.noQty;
        if (!Number.isFinite(winQty) || winQty <= 0) continue;

        const units = Math.round(winQty * UNIT_SCALE);
        await addAvailable(uid, units);

        payouts.push({ userId: uid, winQty, paidUnits: units });
        payTotal += units;
      }

      if (collBefore < payTotal) {
        throw new Error(`collateral_insufficient: have=${collBefore} need=${payTotal}`);
      }
      await kv.set(collKey, collBefore - payTotal);

      const ev2 = await putEvent({
        ...ev,
        status: "resolved",
        result: win,
        resolvedAt: nowISO(),
        payoutsSummary: { count: payouts.length, paidUnits: payTotal },
      });

      return {
        ok: true,
        event: ev2,
        payouts,
        count: payouts.length,
        paidUnits: payTotal,
        collateralBefore: collBefore,
        collateralAfter: collBefore - payTotal,
      };
    });

    return res.status(200).json(out);
  } catch (e) {
    console.error("resolve(pm2) error:", e);
    const msg = e?.message || String(e);
    const code =
      msg.includes("Unauthorized") ? 401 :
      msg.includes("event not found") ? 404 :
      msg.includes("already resolved") ? 400 :
      msg.includes("result must") ? 400 :
      msg.includes("collateral_insufficient") ? 409 :
      500;
    return res.status(code).send(msg);
  }
}
