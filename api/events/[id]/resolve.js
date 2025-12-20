// api/events/[id]/resolve.js
import { loadStore, saveStore, isAuthorized, resolveAndPayout } from "../../_kv.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  if (!isAuthorized(req)) return res.status(401).send("Unauthorized");

  const store = await loadStore();
  const eventId = Number(req.query.id);
  const ev = (store.events || []).find((e) => e.id === eventId);
  if (!ev) return res.status(404).send("event not found");
  if (ev.status === "resolved") return res.status(200).json({ ok: true, event: ev });

  const { optionId } = req.body || {};
  if (!optionId) return res.status(400).send("optionId required");

  resolveAndPayout(store, ev, Number(optionId));
  await saveStore(store);

  return res.status(200).json({ ok: true, event: ev });
}
