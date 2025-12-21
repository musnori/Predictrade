import { loadStore, saveStore, ensureUser } from "../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { deviceId, name } = req.body || {};
    if (!deviceId || !name) return res.status(400).send("deviceId and name required");

    const store = await loadStore();
    const user = ensureUser(store, deviceId);

    // ニックネーム更新（最大20文字）
    user.name = String(name).trim().slice(0, 20);

    // 初回だけポイント付与（ensureUser側で入ってるならこれは無害）
    if (typeof user.points !== "number" || !Number.isFinite(user.points)) user.points = 1000;

    await saveStore(store);
    return res.status(200).json({ ok: true, user });
  } catch (e) {
    console.error("users/index error:", e);
    return res.status(500).send(`users index failed: ${e?.message || String(e)}`);
  }
}
