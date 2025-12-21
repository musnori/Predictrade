// api/events/[id]/resolve.js
import { loadStore, saveStore, ensureUser, isAdminRequest, nowISO } from "../../_kv.js";

function calcParticipantCount(ev) {
  const holdings = ev.holdings && typeof ev.holdings === "object" ? ev.holdings : {};
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

    // 管理者認証（?key= でも x-admin-key でもOK）
    if (!isAdminRequest(req)) return res.status(401).send("Unauthorized");

    const store = await loadStore();
    const eventId = Number(req.query.id);
    const ev = (store.events || []).find((e) => Number(e.id) === eventId);
    if (!ev) return res.status(404).send("event not found");
    if (ev.status === "resolved") return res.status(400).send("event already resolved");

    const { resultOptionId } = req.body || {};
    const winId = Number(resultOptionId);
    if (!Number.isFinite(winId)) return res.status(400).send("resultOptionId required");

    const exists = (ev.options || []).some((o) => Number(o.id) === winId);
    if (!exists) return res.status(400).send("option not found");

    // holdings: deviceId -> { [optionId]: shares }
    ev.holdings = ev.holdings && typeof ev.holdings === "object" ? ev.holdings : {};

    const payouts = [];
    let paidTotal = 0;

    for (const [deviceId, pos] of Object.entries(ev.holdings)) {
      const shares = Number(pos?.[String(winId)] || 0);
      if (!Number.isFinite(shares) || shares <= 0) continue;

      const user = ensureUser(store, deviceId);

      // ✅ 1 share = 1pt を支払い（勝ちのshares分だけ加算）
      user.points = Number(user.points || 0) + shares;

      payouts.push({
        deviceId,
        name: user.name ?? "Guest",
        sharesWon: shares,
        paid: shares,
      });
      paidTotal += shares;
    }

    ev.status = "resolved";
    ev.resultOptionId = winId;
    ev.resolvedAt = nowISO();

    // 監査用ログ
    ev.payouts = payouts;
    ev.paidTotal = paidTotal;

    // 表示用（一覧がズレないように）
    ev.participantCount = calcParticipantCount(ev);
    ev.participants = ev.participantCount;
    ev.poolPoints = calcPoolPoints(ev);

    await saveStore(store);

    return res.status(200).json({
      ok: true,
      event: ev,
      payouts,
      paidTotal,
      count: payouts.length,
    });
  } catch (e) {
    console.error("resolve error:", e);
    return res.status(500).send(`resolve failed: ${e?.message || String(e)}`);
  }
}
