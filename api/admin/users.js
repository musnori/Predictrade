// api/admin/users.js
import { loadStore, saveStore, isAdminRequest } from "../_kv.js";

export default async function handler(req, res) {
  if (!isAdminRequest(req)) {
    return res.status(401).send("Unauthorized");
  }

  const store = await loadStore();
  const action = String(req.query?.action || "users");

  try {
    // =========================
    // 👤 全ユーザー一覧（従来機能）
    // GET /api/admin/users
    // =========================
    if (req.method === "GET" && action === "users") {
      const users = store.users || {};
      const list = Object.entries(users).map(([deviceId, u]) => ({
        deviceId,
        name: u?.name ?? "Guest",
        points: Number(u?.points ?? 0),
      }));
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));
      return res.status(200).json({ count: list.length, users: list });
    }

    // =========================
    // 👥 参加者一覧
    // GET /api/admin/users?action=participants&eventId=1
    // =========================
    if (req.method === "GET" && action === "participants") {
      const eventId = Number(req.query.eventId);
      const ev = (store.events || []).find((e) => Number(e.id) === eventId);
      if (!ev) return res.status(404).send("event not found");

      const holdings = ev.holdings || {};
      const participants = Object.keys(holdings).map((deviceId) => {
        const u = store.users?.[deviceId] || { name: "Guest", points: 0 };
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

      return res.status(200).json({ participants });
    }

    // =========================
    // ❌ 参加者削除
    // POST /api/admin/users?action=removeParticipant&eventId=1&deviceId=xxx
    // =========================
    if (req.method === "POST" && action === "removeParticipant") {
      const eventId = Number(req.query.eventId);
      const deviceId = String(req.query.deviceId || "");
      const ev = (store.events || []).find((e) => Number(e.id) === eventId);
      if (!ev) return res.status(404).send("event not found");

      if (ev.holdings) delete ev.holdings[deviceId];
      if (Array.isArray(ev.trades)) {
        ev.trades = ev.trades.filter((t) => String(t.deviceId) !== deviceId);
      }

      await saveStore(store);
      return res.status(200).json({ ok: true });
    }

    // =========================
    // 🗑 イベント削除
    // POST /api/admin/users?action=deleteEvent&eventId=1
    // =========================
    if (req.method === "POST" && action === "deleteEvent") {
      const eventId = Number(req.query.eventId);
      const before = (store.events || []).length;
      store.events = (store.events || []).filter((e) => Number(e.id) !== eventId);
      if (store.events.length === before) return res.status(404).send("event not found");

      await saveStore(store);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).send("Invalid action or method");
  } catch (e) {
    console.error("admin users error:", e);
    return res.status(500).send(String(e?.message || e));
  }
}
