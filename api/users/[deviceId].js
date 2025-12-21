// api/users/[deviceId].js
import { loadStore } from "../_kv.js";

function normStr(v) {
  return String(v ?? "");
}

function normalizeUser(u) {
  const user = u && typeof u === "object" ? { ...u } : {};
  user.name = String(user.name || "").trim().slice(0, 20);
  user.points = Number(user.points || 0);
  return user;
}

function optionText(ev, optionId) {
  const opt = (ev?.options || []).find((o) => Number(o.id) === Number(optionId));
  return opt?.text ?? "-";
}

function outcomeLabel(ev, optionId) {
  if (!ev || ev.status !== "resolved") return "未確定";
  const win = Number(ev.resultOptionId);
  const bet = Number(optionId);
  if (!Number.isFinite(win) || !Number.isFinite(bet)) return "未確定";
  return win === bet ? "的中" : "ハズレ";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).send("deviceId required");

    const store = await loadStore();
    const rawUser = store.users?.[deviceId];
    if (!rawUser) return res.status(404).send("not found");

    const user = normalizeUser(rawUser);

    // ===== 履歴モード =====
    if (req.query.action === "history") {
      const events = Array.isArray(store.events) ? store.events : [];
      const history = [];

      for (const ev of events) {
        const trades = Array.isArray(ev.trades) ? ev.trades : [];
        for (const t of trades) {
          if (normStr(t.deviceId) !== normStr(deviceId)) continue;

          history.push({
            // event
            eventId: ev.id,
            eventTitle: ev.title ?? "-",
            category: ev.category ?? "-",
            endDate: ev.endDate ?? null,
            eventStatus: ev.status ?? "open",
            resultOptionId: ev.resultOptionId ?? null,

            // trade
            createdAt: t.createdAt ?? null,
            optionId: Number(t.optionId),
            optionText: optionText(ev, t.optionId),
            shares: Number(t.shares || 0),
            cost: Number(t.cost || 0),

            // status
            outcome: outcomeLabel(ev, t.optionId),
          });
        }
      }

      history.sort((a, b) => normStr(b.createdAt).localeCompare(normStr(a.createdAt)));

      return res.status(200).json({
        ok: true,
        user,
        history,
        count: history.length,
      });
    }

    // ===== 通常：統一形式で返す =====
    return res.status(200).json({ ok: true, user });
  } catch (e) {
    console.error("users/[deviceId] error:", e);
    return res.status(500).send(`users api failed: ${e?.message || String(e)}`);
  }
}
