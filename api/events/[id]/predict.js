// api/events/[id]/predict.js
import { loadStore, saveStore, ensureUser } from "../../_kv.js";

function pushSnapshot(ev) {
  const total = Number(ev.totalStaked || 0);
  const probs = {};
  for (const o of ev.options || []) {
    const s = Number(o.staked || 0);
    probs[o.id] = total <= 0 ? 0 : Math.round((s / total) * 1000) / 10; // 0.1%
  }
  ev.snapshots = Array.isArray(ev.snapshots) ? ev.snapshots : [];
  ev.snapshots.push({ t: new Date().toISOString(), probs });
  if (ev.snapshots.length > 200) ev.snapshots = ev.snapshots.slice(-200);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const store = await loadStore();
  const eventId = Number(req.query.id);
  const ev = (store.events || []).find((e) => e.id === eventId);
  if (!ev) return res.status(404).send("event not found");
  if (ev.status === "resolved") return res.status(400).send("event already resolved");

  const now = Date.now();
  const end = new Date(ev.endDate).getTime();
  if (!Number.isFinite(end)) return res.status(400).send("invalid endDate");
  if (now >= end) return res.status(400).send("event closed");

  const { deviceId, optionId, points } = req.body || {};
  if (!deviceId || !optionId) return res.status(400).send("deviceId and optionId required");

  const user = ensureUser(store, deviceId);

  const p = Number(points || 0);
  if (!Number.isFinite(p)) return res.status(400).send("points must be a number");
  if (p < 10 || p > 1000) return res.status(400).send("points must be 10..1000");
  if (user.points < p) return res.status(400).send("not enough points");

  const opt = (ev.options || []).find((o) => o.id === Number(optionId));
  if (!opt) return res.status(400).send("option not found");

  ev.predictions = Array.isArray(ev.predictions) ? ev.predictions : [];
  const alreadyParticipated = ev.predictions.some((pred) => pred.deviceId === deviceId);

  // ✅ 賭けポイントを引く
  user.points -= p;

  // ✅ ここがプールになる
  opt.staked = Number(opt.staked || 0) + p;
  ev.totalStaked = Number(ev.totalStaked || 0) + p;

  if (!alreadyParticipated) ev.participants = Number(ev.participants || 0) + 1;

  ev.predictions.unshift({
    deviceId,
    name: user.name,
    optionId: opt.id,
    points: p,
    createdAt: new Date().toISOString(),
    payout: 0,
  });

  pushSnapshot(ev);

  await saveStore(store);
  return res.status(200).json({ ok: true, user, event: ev });
}
