// api/admin/users/[id]/name.js
import { kv } from "@vercel/kv";
import { getUser, isAdminRequest, k, nowISO } from "../../../_kv.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    if (!isAdminRequest(req)) return res.status(401).send("Unauthorized");

    const userId = String(req.query.id || "").trim();
    if (!userId) return res.status(400).send("user id required");

    const user = await getUser(userId);
    if (!user) return res.status(404).send("user not found");

    const next = { ...user, displayName: "Guest", updatedAt: nowISO() };
    await kv.set(k.user(userId), next);

    return res.status(200).json({ ok: true, user: next });
  } catch (e) {
    console.error("admin/users/[id]/name error:", e);
    return res.status(500).send(`name update failed: ${e?.message || String(e)}`);
  }
}
