// api/users/index.js (PM v2)
import {
  ensureUser,
  getBalance,
  listUserIds,
  getUser,
  isAdminRequest,
} from "../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const { deviceId, name } = req.body || {};
      if (!deviceId) return res.status(400).send("deviceId required");

      const user = await ensureUser(String(deviceId), String(name || "Guest"));
      const bal = await getBalance(String(deviceId)); // {available, locked} (units)

      return res.status(200).json({
        ok: true,
        user,
        balanceUnits: bal,
      });
    }

    // admin: list users
    if (req.method === "GET") {
      if (!isAdminRequest(req)) return res.status(401).send("admin only");

      const ids = await listUserIds();
      const out = [];
      for (const id of ids) {
        const [u, b] = await Promise.all([getUser(id), getBalance(id)]);
        if (u) out.push({ ...u, balanceUnits: b });
      }
      return res.status(200).json({ ok: true, users: out });
    }

    return res.status(405).send("Method Not Allowed");
  } catch (e) {
    console.error("users/index error:", e);
    return res.status(500).send(`users failed: ${e?.message || String(e)}`);
  }
}
