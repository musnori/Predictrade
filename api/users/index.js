import { loadStore, saveStore, ensureUser } from "../_kv.js";

function normalizeName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { deviceId, name } = req.body || {};
    if (!deviceId) return res.status(400).send("deviceId required");

    const n = normalizeName(name);
    if (!n) return res.status(400).send("name required");

    const store = await loadStore();
    const user = ensureUser(store, deviceId);

    // 型のブレを潰す（ズレ防止）
    user.points = Number(user.points || 0);
    user.name = n;

    await saveStore(store);
    return res.status(200).json({ ok: true, user });
  } catch (e) {
    console.error("users upsert error:", e);
    return res.status(500).send(`users upsert failed: ${e?.message || String(e)}`);
  }
}
