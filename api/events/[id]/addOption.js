import { loadStore, saveStore, ensureUser, sanitizeText, nowISO } from "../../_kv.js";

function normText(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
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

    const { deviceId, text } = req.body || {};
    if (!deviceId) return res.status(400).send("deviceId required");

    const cleaned = sanitizeText ? sanitizeText(text) : String(text || "").trim();
    if (!cleaned) return res.status(400).send("text required");

    // ✅ サーバ側で重複禁止
    const t = normText(cleaned);
    const exists = (ev.options || []).some((o) => normText(o.text) === t);
    if (exists) return res.status(400).send("duplicate option");

    const user = ensureUser(store, deviceId);

    ev.options = Array.isArray(ev.options) ? ev.options : [];
    const nextId = ev.options.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0) + 1;

    ev.options.push({
      id: nextId,
      text: cleaned,
      q: 0,
      createdAt: nowISO(),
      createdBy: user.name,
    });

    await saveStore(store);
    return res.status(200).json({ ok: true, event: ev });
  } catch (e) {
    console.error("addOption error:", e);
    return res.status(500).send(`addOption failed: ${e?.message || String(e)}`);
  }
}
