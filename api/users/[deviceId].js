import { loadStore } from "../_kv.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  const { deviceId } = req.query;
  const store = await loadStore();
  const user = store.users?.[deviceId];
  if (!user) return res.status(404).send("not found");

  res.status(200).json(user);
}
