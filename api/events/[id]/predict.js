// api/events/[id]/predict.js
import { loadStore, saveStore, ensureUser } from "../../_kv.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const store = await loadStore();
  const eventId = Number(req.query.id);

  const ev = (store.events || []).find((e) => e.id === eventId);
  if (!ev) return res.status(404).send("event not found");

  // ✅ 締切チェック（終了後は投稿不可）
  const now = Date.now();
  const end = new Date(ev.endDate).getTime();
  if (!Number.isFinite(end)) return res.status(400).send("invalid endDate");
  if (now >= end) return res.status(400).send("event closed");

  const { deviceId, optionId, points, confidence } = req.body || {};
  if (!deviceId || !optionId) return res.status(400).send("deviceId and optionId required");

  const user = ensureUser(store, deviceId);

  const p = Number(points || 0);
  if (!Number.isFinite(p)) return res.status(400).send("points must be a number");
  if (p < 10 || p > 1000) return res.status(400).send("points must be 10..1000");
  if (user.points < p) return res.status(400).send("not enough points");

  const opt = (ev.options || []).find((o) => o.id === Number(optionId));
  if (!opt) return res.status(400).send("option not found");

  // predictions を必ず配列化
  ev.predictions = Array.isArray(ev.predictions) ? ev.predictions : [];

  // ✅ 「このイベントに初参加か？」を判定（同じdeviceIdの投稿があるか）
  const alreadyParticipated = ev.predictions.some((pred) => pred.deviceId === deviceId);

  // ---- 更新処理 ----
  user.points -= p;

  // votes は「投票回数（投稿回数）」としてそのままカウント
  opt.votes = (opt.votes || 0) + 1;

  // ✅ participants はユニーク参加者として初回のみ+1
  if (!alreadyParticipated) {
    ev.participants = (ev.participants || 0) + 1;
  }

  // 投稿ログ追加
  ev.predictions.unshift({
    deviceId,
    name: user.name,
    optionId: opt.id,
    points: p,
    confidence: Number(confidence || 0),
    createdAt: new Date().toISOString(),
  });

  await saveStore(store);
  return res.status(200).json({ ok: true, user, event: ev });
}
