// api/events/[id]/resolve.js
import { loadStore, saveStore, ensureUser, isAdminRequest, nowISO } from "../../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    // admin auth (?key= or x-admin-key)
    if (!isAdminRequest(req)) return res.status(401).send("Unauthorized");

    const store = await loadStore();
    const eventId = Number(req.query.id);
    const ev = (store.events || []).find((e) => Number(e.id) === eventId);
    if (!ev) return res.status(404).send("event not found");

    if (ev.status === "resolved") return res.status(400).send("event already resolved");

    const { resultOptionId } = req.body || {};
    const winId = Number(resultOptionId);
    if (!Number.isFinite(winId)) return res.status(400).send("resultOptionId required");

    const exists = (ev.options || []).some((o) => Number(o.id) === winId);
    if (!exists) return res.status(400).send("option not found");

    // holdings: deviceId -> { [optionId]: shares }
    ev.holdings = ev.holdings && typeof ev.holdings === "object" ? ev.holdings : {};

    const payouts = [];
    let paidTotal = 0;

    for (const [deviceId, pos] of Object.entries(ev.holdings)) {
      const shares = Number(pos?.[String(winId)] || 0);
      if (!Number.isFinite(shares) || shares <= 0) continue;

      const user = ensureUser(store, deviceId);

      // payout: 1 share = 1pt
      user.points = Number(user.points || 0) + shares;

      payouts.push({
        deviceId,
        name: user.name ?? "Guest",
        sharesWon: shares,
        paid: shares,
      });
      paidTotal += shares;
    }

    ev.status = "resolved";
    ev.resultOptionId = winId;
    ev.resolvedAt = nowISO();
    ev.payouts = payouts;
    ev.paidTotal = paidTotal;

    await saveStore(store);

    return res.status(200).json({
      ok: true,
      event: ev,
      payouts,
      paidTotal,
      count: payouts.length,
    });
  } catch (e) {
    console.error("resolve error:", e);
    return res.status(500).send(`resolve failed: ${e?.message || String(e)}`);
  }
}
