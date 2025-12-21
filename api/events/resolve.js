import { loadStore, saveStore, ensureUser, isAdminRequest, nowISO } from "../../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("admin only");

    const store = await loadStore();
    const eventId = Number(req.query.id);
    const ev = (store.events || []).find((e) => Number(e.id) === eventId);
    if (!ev) return res.status(404).send("event not found");
    if (ev.status === "resolved") return res.status(400).send("event already resolved");

    const { resultOptionId } = req.body || {};
    const rid = Number(resultOptionId);
    if (!Number.isFinite(rid)) return res.status(400).send("resultOptionId required");

    const opt = (ev.options || []).find((o) => Number(o.id) === rid);
    if (!opt) return res.status(400).send("option not found");

    // payout: 1pt per winning share
    const payouts = [];
    const holdings = ev.holdings && typeof ev.holdings === "object" ? ev.holdings : {};

    for (const [deviceId, byOpt] of Object.entries(holdings)) {
      const winShares = Number(byOpt?.[String(rid)] || 0);
      if (winShares <= 0) continue;

      const u = ensureUser(store, deviceId);
      const payout = winShares; // 1pt per share
      u.points += payout;

      payouts.push({ deviceId, name: u.name, shares: winShares, points: payout });
    }

    ev.status = "resolved";
    ev.resolvedAt = nowISO();
    ev.resultOptionId = rid;
    ev.payouts = payouts;

    await saveStore(store);
    return res.status(200).json({ ok: true, event: ev, payouts });
  } catch (e) {
    console.error("resolve error:", e);
    return res.status(500).send(`resolve failed: ${e?.message || String(e)}`);
  }
}
