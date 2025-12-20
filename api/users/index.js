import { loadStore, saveStore, ensureUser } from "../_kv.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const { deviceId, name } = req.body || {};
  if (!deviceId || !name) return res.status(400).send("deviceId and name required");

  const store = await loadStore();
  const user = ensureUser(store, deviceId);
  user.name = String(name).slice(0, 20);

  await saveStore(store);
  res.status(200).json({ ok: true, user });
}
