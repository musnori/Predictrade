import { loadStore, isAdminRequest } from "../../../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("unauthorized");

    const store = await loadStore();
    const eventId = Number(req.query.id);
    const ev = (store.events || []).find((e) => Number(e.id) === eventId);
    if (!ev) return res.status(404).send("event not found");

    const holdings = ev.holdings && typeof ev.holdings === "object" ? ev.holdings : {};
    const deviceIds = Object.keys(holdings);

    const participants = deviceIds.map((deviceId) => {
      const u = store.users?.[deviceId] || { name: "Unknown", points: 0 };
      const byOpt = holdings[deviceId] || {};
      const totalShares = Object.values(byOpt).reduce((a, v) => a + Number(v || 0), 0);
      return {
        deviceId,
        name: u.name,
        points: u.points,
        totalShares,
        byOption: byOpt,
      };
    });

    return res.status(200).json({ ok: true, participants });
  } catch (e) {
    console.error("admin participants error:", e);
    return res.status(500).send(`participants failed: ${e?.message || String(e)}`);
  }
}
