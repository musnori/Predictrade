import { isAdminRequest, getEvent, putEvent, nowISO, sanitizeText, appendRulesUpdate, appendAuditLog } from "../../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("admin only");

    const eventId = String(req.query.id || "").trim();
    if (!eventId) return res.status(400).send("event id required");

    const { text, by } = req.body || {};
    const updateText = sanitizeText(text, 1200);
    if (!updateText) return res.status(400).send("clarification text required");

    const ev = await getEvent(eventId);
    if (!ev) return res.status(404).send("event not found");
    if (ev.status === "resolved") return res.status(400).send("event already resolved");

    const update = {
      at: nowISO(),
      by: sanitizeText(by || "admin", 32) || "admin",
      type: "clarification",
      text: updateText,
    };

    await appendRulesUpdate(eventId, update);
    await putEvent({ ...ev, updatedAt: nowISO() });
    await appendAuditLog(eventId, {
      at: nowISO(),
      type: "clarification",
      by: update.by,
      text: updateText,
    });

    return res.status(200).json({ ok: true, update });
  } catch (e) {
    console.error("clarify error:", e);
    return res.status(500).send(`clarify failed: ${e?.message || String(e)}`);
  }
}
