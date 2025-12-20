// api/events/[id]/resolve.js
import { loadStore, saveStore, isAuthorized, resolveAndPayout, maybeAutoResolveEvent } from "../../_kv.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const store = await loadStore();
  const eventId = Number(req.query.id);
  const ev = (store.events || []).find((e) => e.id === eventId);
  if (!ev) return res.status(404).send("event not found");

  // 期限到来なら先に自動resolveが走る（重複防止）
  const autoChanged = maybeAutoResolveEvent(store, ev);
  if (autoChanged) {
    await saveStore(store);
    return res.status(200).json({ ok: true, event: ev, mode: "auto(already)" });
  }

  // 管理者鍵（ADMIN_KEY設定時のみ必須）
  if (!isAuthorized(req)) return res.status(401).send("Unauthorized");

  if (ev.status === "resolved") return res.status(200).json({ ok: true, event: ev, mode: "already" });

  const { optionId, mode = "manual" } = req.body || {};

  // mode="auto" なら「今の先頭オッズで確定」
  if (mode === "auto") {
    // staked最大（同点ならvotes）
    const opts = ev.options || [];
    if (opts.length === 0) return res.status(400).send("no options");
    let winner = opts[0];
    for (const o of opts) {
      if ((o.staked || 0) > (winner.staked || 0)) winner = o;
      else if ((o.staked || 0) === (winner.staked || 0) && (o.votes || 0) > (winner.votes || 0))
        winner = o;
    }
    resolveAndPayout(store, ev, winner.id, "manual-auto");
  } else {
    if (!optionId) return res.status(400).send("optionId required");
    resolveAndPayout(store, ev, Number(optionId), "manual-pick");
  }

  await saveStore(store);
  return res.status(200).json({ ok: true, event: ev, mode });
}
