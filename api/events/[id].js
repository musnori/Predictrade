// api/events/[id].js
import { loadStore, saveStore, maybeAutoResolveEvent } from "../_kv.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  const store = await loadStore();
  const id = Number(req.query.id);
  const ev = (store.events || []).find((e) => e.id === id);
  if (!ev) return res.status(404).send("not found");

  // ✅ 期限を過ぎていれば「自動resolve→自動分配」
  const changed = maybeAutoResolveEvent(store, ev);
  if (changed) await saveStore(store);

  res.status(200).json(ev);
}
