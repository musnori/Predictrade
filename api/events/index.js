import {
  loadStore,
  saveStore,
  ensureUser,
  isAdminRequest,
  sanitizeText,
  nowISO,
} from "../_kv.js";

function calcParticipantCount(ev) {
  const holdings =
    ev.holdings && typeof ev.holdings === "object" ? ev.holdings : {};
  return Object.entries(holdings).filter(([_, pos]) => {
    if (!pos || typeof pos !== "object") return false;
    return Object.values(pos).some((v) => Number(v || 0) > 0);
  }).length;
}

function calcPoolPointsInt(ev) {
  const trades = Array.isArray(ev.trades) ? ev.trades : [];
  // ✅ 過去の小数costが残ってても「整数合計」として扱う
  return trades.reduce((a, t) => a + Math.round(Number(t?.cost || 0)), 0);
}

export default async function handler(req, res) {
  try {
    const store = await loadStore();

    if (req.method === "GET") {
      const events = Array.isArray(store.events) ? store.events : [];

      // ✅ 表示用に整形して返す（保存はしない）
      const shaped = events.map((ev) => {
        const participants = calcParticipantCount(ev);
        const poolPoints = calcPoolPointsInt(ev);

        return {
          ...ev,
          participants: ev.participants ?? participants,
          participantCount: ev.participantCount ?? participants,
          poolPoints: ev.poolPoints ?? poolPoints,
          // 互換：古いUIが prizePool を参照してても整数が出るように
          prizePool: ev.prizePool ?? poolPoints,
        };
      });

      return res.status(200).json(shaped);
    }

    if (req.method === "POST") {
      // ✅ 管理者のみ作成（Polymarketの「オーガナイザー」）
      if (!isAdminRequest(req))
        return res.status(401).send("admin only (set ADMIN_KEY)");

      const {
        title,
        description,
        category,
        endDate,
        options,
        liquidityB,
        deviceId,
      } = req.body || {};
      if (!deviceId) return res.status(400).send("deviceId required");

      const user = ensureUser(store, deviceId);

      const t = sanitizeText(title, 80);
      const d = sanitizeText(description, 400);
      const c = sanitizeText(category, 30);

      if (!t || !d || !c || !endDate)
        return res.status(400).send("missing fields");

      const end = new Date(endDate).getTime();
      if (!Number.isFinite(end)) return res.status(400).send("invalid endDate");

      const optTexts = Array.isArray(options)
        ? options.map((x) => sanitizeText(x, 50)).filter(Boolean)
        : [];
      if (optTexts.length < 2 || optTexts.length > 6)
        return res.status(400).send("options must be 2..6");

      const b = Number(liquidityB ?? 50);
      if (!Number.isFinite(b) || b <= 0)
        return res.status(400).send("invalid liquidityB");

      const nextId =
        (store.events || []).reduce(
          (m, e) => Math.max(m, Number(e.id) || 0),
          0
        ) + 1;

      const ev = {
        id: nextId,
        title: t,
        description: d,
        category: c,
        status: "active", // active | resolved
        createdAt: nowISO(),
        endDate: new Date(end).toISOString(),

        organizerDeviceId: deviceId,
        organizerName: user.name,

        liquidityB: b,

        options: optTexts.map((text, i) => ({
          id: i + 1,
          text,
          q: 0,
          createdAt: nowISO(),
          createdBy: "organizer",
        })),

        holdings: {},
        trades: [],
        snapshots: [],

        // ✅ 初期値（整数）
        participants: 0,
        participantCount: 0,
        poolPoints: 0,
        prizePool: 0, // 互換

        resolvedAt: null,
        resultOptionId: null,
      };

      ev.snapshots.push({
        t: nowISO(),
        prices: Object.fromEntries(
          ev.options.map((o) => [o.id, 1 / ev.options.length])
        ),
      });

      store.events.unshift(ev);
      await saveStore(store);

      return res.status(200).json(ev);
    }

    return res.status(405).send("Method Not Allowed");
  } catch (e) {
    console.error("events/index error:", e);
    return res
      .status(500)
      .send(`events index failed: ${e?.message || String(e)}`);
  }
}
