import { loadStore, saveStore, isAdminRequest } from "../../../../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("unauthorized");

    const store = await loadStore();
    const eventId = Number(req.query.id);
    const deviceId = String(req.query.deviceId || "");

    const ev = (store.events || []).find((e) => Number(e.id) === eventId);
    if (!ev) return res.status(404).send("event not found");

    // holdings/trades から削除（ポイント返金はしない：要るなら次で足せる）
    if (ev.holdings && typeof ev.holdings === "object") {
      delete ev.holdings[deviceId];
    }
    if (Array.isArray(ev.trades)) {
      ev.trades = ev.trades.filter((t) => String(t.deviceId) !== deviceId);
    }

    await saveStore(store);
    return res.status(200).json({ ok: true, event: ev });
  } catch (e) {
    console.error("admin remove participant error:", e);
    return res.status(500).send(`remove participant failed: ${e?.message || String(e)}`);
  }
}
