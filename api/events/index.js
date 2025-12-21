import { loadStore, saveStore, ensureUser, isAdminRequest, sanitizeText, nowISO } from "../_kv.js";

export default async function handler(req, res) {
  try {
    const store = await loadStore();

    if (req.method === "GET") {
      return res.status(200).json(store.events || []);
    }

    if (req.method === "POST") {
      // ✅ 管理者のみ作成（Polymarketの「オーガナイザー」）
      if (!isAdminRequest(req)) return res.status(401).send("admin only (set ADMIN_KEY)");

      const { title, description, category, endDate, options, liquidityB, deviceId } = req.body || {};
      if (!deviceId) return res.status(400).send("deviceId required");

      const user = ensureUser(store, deviceId);

      const t = sanitizeText(title, 80);
      const d = sanitizeText(description, 400);
      const c = sanitizeText(category, 30);

      if (!t || !d || !c || !endDate) return res.status(400).send("missing fields");

      const end = new Date(endDate).getTime();
      if (!Number.isFinite(end)) return res.status(400).send("invalid endDate");

      const optTexts = Array.isArray(options)
        ? options.map((x) => sanitizeText(x, 50)).filter(Boolean)
        : [];
      if (optTexts.length < 2 || optTexts.length > 6) return res.status(400).send("options must be 2..6");

      const b = Number(liquidityB ?? 50);
      if (!Number.isFinite(b) || b <= 0) return res.status(400).send("invalid liquidityB");

      const nextId = (store.events || []).reduce((m, e) => Math.max(m, Number(e.id) || 0), 0) + 1;

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

        // ✅ LMSR liquidity
        liquidityB: b,

        // ✅ outcomes (each has sharesOutstanding q)
        options: optTexts.map((text, i) => ({
          id: i + 1,
          text,
          q: 0, // outstanding shares
          createdAt: nowISO(),
          createdBy: "organizer",
        })),

        // holdings: deviceId -> { [optionId]: shares }
        holdings: {},

        trades: [], // { deviceId, name, optionId, shares, cost, createdAt }
        snapshots: [], // { t, prices: { [optionId]: price } }

        resolvedAt: null,
        resultOptionId: null,
      };

      // 初期スナップショット（均等）
      ev.snapshots.push({
        t: nowISO(),
        prices: Object.fromEntries(ev.options.map((o) => [o.id, 1 / ev.options.length])),
      });

      store.events.unshift(ev);
      await saveStore(store);

      return res.status(200).json(ev);
    }

    return res.status(405).send("Method Not Allowed");
  } catch (e) {
    console.error("events/index error:", e);
    return res.status(500).send(`events index failed: ${e?.message || String(e)}`);
  }
}
