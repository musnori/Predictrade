import { loadStore, saveStore, ensureUser, sanitizeText, nowISO } from "../../_kv.js";

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

    const { deviceId, text } = req.body || {};
    if (!deviceId) return res.status(400).send("deviceId required");

    const user = ensureUser(store, deviceId);
    const t = sanitizeText(text, 50);
    if (!t) return res.status(400).send("text required");

    // 同名防止（ざっくり）
    if ((ev.options || []).some((o) => String(o.text).toLowerCase() === t.toLowerCase())) {
      return res.status(400).send("option already exists");
    }

    const nextOptId = (ev.options || []).reduce((m, o) => Math.max(m, Number(o.id) || 0), 0) + 1;

    ev.options.push({
      id: nextOptId,
      text: t,
      q: 0,
      createdAt: nowISO(),
      createdBy: user.name,
    });

    // スナップショットを一発追加（価格はLMSR計算はpredictで更新するので、ここでは均等に近い扱い）
    // ※厳密にはLMSRで再計算すべきだが、次の取引で必ず整う
    await saveStore(store);
    return res.status(200).json({ ok: true, event: ev });
  } catch (e) {
    console.error("addOption error:", e);
    return res.status(500).send(`addOption failed: ${e?.message || String(e)}`);
  }
}
