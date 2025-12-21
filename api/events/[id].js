import { loadStore } from "../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
    const store = await loadStore();
    const id = Number(req.query.id);
    const ev = (store.events || []).find((e) => Number(e.id) === id);
    if (!ev) return res.status(404).send("event not found");
    return res.status(200).json(ev);
  } catch (e) {
    console.error("events/[id] error:", e);
    return res.status(500).send(`event read failed: ${e?.message || String(e)}`);
  }
}
