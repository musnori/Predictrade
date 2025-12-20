// api/admin/reset.js
import { kv } from "@vercel/kv";

const KEY = "predictrade:store:v1";

function isAuthorized(req) {
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (!ADMIN_KEY) return false;

  const keyFromQuery = req.query?.key;
  const keyFromHeader = req.headers["x-admin-key"];
  return keyFromQuery === ADMIN_KEY || keyFromHeader === ADMIN_KEY;
}

export default async function handler(req, res) {
  // 危険なので POST のみ
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  if (!isAuthorized(req)) {
    return res.status(401).send("Unauthorized");
  }

  // ✅ 全データ初期化（users / events / predictions 全消し）
  const emptyStore = {
    events: [],
    users: {},
  };

  await kv.set(KEY, emptyStore);

  return res.status(200).json({
    ok: true,
    message: "PredicTrade store has been reset",
    key: KEY,
  });
}
