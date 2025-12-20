// api/events/index.js
import { loadStore, saveStore } from "../_kv.js";

export default async function handler(req, res) {
  const store = await loadStore();

  if (req.method === "GET") {
    // 期限到来の自動resolveは /api/events/[id] 側で必ず発火する設計
    return res.status(200).json(store.events || []);
  }

  if (req.method === "POST") {
    const { title, description, category, endDate, prizePool, options } = req.body || {};
    if (!title || !description || !category || !endDate) return res.status(400).send("missing fields");
    if (!Array.isArray(options) || options.length < 2 || options.length > 4)
      return res.status(400).send("options must be 2..4");

    const id = Math.max(0, ...(store.events || []).map((e) => Number(e.id || 0))) + 1;

    const ev = {
      id,
      title: String(title).slice(0, 120),
      description: String(description).slice(0, 600),
      category,
      status: "active",
      endDate: new Date(endDate).toISOString(),
      participants: 0,
      prizePool: Number(prizePool || 0),

      totalStaked: 0,
      options: options.map((t, idx) => ({
        id: idx + 1,
        text: String(t).slice(0, 60),
        votes: 0,
        staked: 0,
      })),
      predictions: [],
      snapshots: [],
      resolvedOptionId: null,
      resolvedAt: null,
      payoutDone: false,
    };

    store.events.unshift(ev);
    await saveStore(store);
    return res.status(200).json(ev);
  }

  return res.status(405).send("Method Not Allowed");
}
