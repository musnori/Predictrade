import { loadStore, saveStore } from "../_kv.js";

export default async function handler(req, res) {
  const store = await loadStore();

  if (req.method === "GET") {
    return res.status(200).json(store.events || []);
  }

  if (req.method === "POST") {
    const { title, description, category, endDate, prizePool, options } = req.body || {};
    if (!title || !description || !endDate || !prizePool || !Array.isArray(options) || options.length < 2) {
      return res.status(400).send("invalid payload");
    }

    const nextId = (store.events.reduce((m, e) => Math.max(m, e.id), 0) || 0) + 1;

    const ev = {
      id: nextId,
      title,
      description,
      category: category || "other",
      status: "active",
      endDate,
      participants: 0,
      prizePool: Number(prizePool),
      options: options.slice(0, 4).map((t, i) => ({ id: i + 1, text: t, votes: 0 })),
      predictions: [],
    };

    store.events.unshift(ev);
    await saveStore(store);
    return res.status(200).json(ev);
  }

  return res.status(405).send("Method Not Allowed");
}
