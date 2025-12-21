import { loadStore, saveStore, isAdminRequest } from "../../../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("unauthorized");

    const store = await loadStore();
    const eventId = Number(req.query.id);

    const before = (store.events || []).length;
    store.events = (store.events || []).filter((e) => Number(e.id) !== eventId);
    const after = store.events.length;

    if (before === after) return res.status(404).send("event not found");

    await saveStore(store);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("admin delete event error:", e);
    return res.status(500).send(`delete event failed: ${e?.message || String(e)}`);
  }
}
