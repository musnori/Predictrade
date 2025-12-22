import { kv } from "@vercel/kv";
import { getEvent, k, PRICE_SCALE } from "../../_kv.js";
import { computeOrderbook, computeDisplayPrice, getLastTrade } from "../../_market.js";

function toNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const eventId = String(req.query.id || "").trim();
    const deviceId = String(req.query.deviceId || "").trim();
    if (!eventId || !deviceId) return res.status(400).send("event id & deviceId required");

    const ev = await getEvent(eventId);
    if (!ev) return res.status(404).send("event not found");

    const pos = await kv.get(k.position(eventId, deviceId));
    const obj = pos && typeof pos === "object" ? pos : { yesQty: 0, noQty: 0 };

    const orderbook = await computeOrderbook(eventId);
    const lastTrade = await getLastTrade(eventId);
    const display = computeDisplayPrice(orderbook, lastTrade);
    const yesPrice = display.displayYesBps / PRICE_SCALE;
    const noPrice = display.displayNoBps / PRICE_SCALE;

    const yesQty = toNum(obj.yesQty);
    const noQty = toNum(obj.noQty);
    const estValue = yesQty * yesPrice + noQty * noPrice;

    return res.status(200).json({
      ok: true,
      position: { yesQty, noQty },
      markPrice: { yes: yesPrice, no: noPrice, yesBps: display.displayYesBps },
      estimatedValue: estValue,
    });
  } catch (e) {
    console.error("position error:", e);
    return res.status(500).send(`position failed: ${e?.message || String(e)}`);
  }
}
