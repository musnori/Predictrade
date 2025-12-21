// api/events/[id]/predict.js
import {
  loadStore,
  saveStore,
  ensureUser,
  lmsrPrices,
  lmsrCostDelta,
  nowISO,
} from "../../_kv.js";

function calcParticipantCount(ev) {
  const holdings = ev.holdings && typeof ev.holdings === "object" ? ev.holdings : {};
  // “勝手に空オブジェが入ってる”ケースもあるので、shares>0 の人だけ数える
  return Object.entries(holdings).filter(([_, pos]) => {
    if (!pos || typeof pos !== "object") return false;
    return Object.values(pos).some((v) => Number(v || 0) > 0);
  }).length;
}

function calcPoolPoints(ev) {
  const trades = Array.isArray(ev.trades) ? ev.trades : [];
  return trades.reduce((a, t) => a + Number(t?.cost || 0), 0);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const store = await loadStore();
    const eventId = Number(req.query.id);
    const ev = (store.events || []).find((e) => Number(e.id) === eventId);
    if (!ev) return res.status(404).send("event not found");
    if (ev.status === "resolved") return res.status(400).send("event already resolved");

    const end = new Date(ev.endDate).getTime();
    if (Number.isFinite(end) && Date.now() >= end) return res.status(400).send("event closed");

    const { deviceId, optionId, shares } = req.body || {};
    if (!deviceId || !optionId) return res.status(400).send("deviceId and optionId required");

    const user = ensureUser(store, deviceId);

    const sh = Number(shares || 0);
    if (!Number.isFinite(sh) || sh <= 0) return res.status(400).send("shares must be > 0");
    if (sh > 1000) return res.status(400).send("shares too large (<=1000)");

    const idx = (ev.options || []).findIndex((o) => Number(o.id) === Number(optionId));
    if (idx < 0) return res.status(400).send("option not found");

    const b = Number(ev.liquidityB || 50);
    const qArr = (ev.options || []).map((o) => Number(o.q || 0));

    const cost = lmsrCostDelta(qArr, idx, sh, b);
    const costCeil = Math.ceil(cost * 1000) / 1000;

    if (user.points < costCeil) return res.status(400).send("not enough points");

    // 更新
    user.points -= costCeil;
    ev.options[idx].q = Number(ev.options[idx].q || 0) + sh;

    // holdings
    ev.holdings = ev.holdings && typeof ev.holdings === "object" ? ev.holdings : {};
    ev.holdings[deviceId] =
      ev.holdings[deviceId] && typeof ev.holdings[deviceId] === "object" ? ev.holdings[deviceId] : {};
    ev.holdings[deviceId][String(optionId)] = Number(ev.holdings[deviceId][String(optionId)] || 0) + sh;

    // trades
    ev.trades = Array.isArray(ev.trades) ? ev.trades : [];
    ev.trades.unshift({
      deviceId,
      name: user.name,
      optionId: Number(optionId),
      shares: sh,
      cost: costCeil,
      createdAt: nowISO(),
    });

    // snapshot
    const newQ = (ev.options || []).map((o) => Number(o.q || 0));
    const ps = lmsrPrices(newQ, b);
    const prices = {};
    ev.options.forEach((o, i) => (prices[o.id] = ps[i]));
    ev.snapshots = Array.isArray(ev.snapshots) ? ev.snapshots : [];
    ev.snapshots.push({ t: nowISO(), prices });
    if (ev.snapshots.length > 300) ev.snapshots = ev.snapshots.slice(-300);

    // ✅ 参加者数・プールを更新（一覧表示がズレないように）
    ev.participantCount = calcParticipantCount(ev);
    ev.participants = ev.participantCount; // UIがparticipants参照してても動くように保険
    ev.poolPoints = calcPoolPoints(ev);

    await saveStore(store);
    return res.status(200).json({ ok: true, user, event: ev });
  } catch (e) {
    console.error("predict(buy) error:", e);
    return res.status(500).send(`buy failed: ${e?.message || String(e)}`);
  }
}
