// api/admin/users.js
import { loadStore } from "../_kv.js";

function isAuthorized(req) {
  // Vercel の環境変数で設定（推奨）
  const ADMIN_KEY = process.env.ADMIN_KEY;

  // もし未設定なら、事故防止で「拒否」(開発だけ許可したいなら変えてOK)
  if (!ADMIN_KEY) return false;

  const keyFromQuery = req.query?.key;
  const keyFromHeader = req.headers["x-admin-key"];

  return keyFromQuery === ADMIN_KEY || keyFromHeader === ADMIN_KEY;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  if (!isAuthorized(req)) {
    return res.status(401).send("Unauthorized");
  }

  const store = await loadStore();
  const users = store.users || {};

  // 見やすい形に整形
  const list = Object.entries(users).map(([deviceId, u]) => ({
    deviceId,
    name: u?.name ?? "Guest",
    points: Number(u?.points ?? 0),
  }));

  // 任意：名前順
  list.sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));

  res.status(200).json({
    count: list.length,
    users: list,
  });
}
