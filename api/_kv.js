// api/_kv.js
import { kv } from "@vercel/kv";

const KEY = "predictrade:store:v2";

function defaultStore() {
  return {
    events: [],
    users: {},
  };
}

function migrateStore(store) {
  const s = store && typeof store === "object" ? store : defaultStore();
  s.events = Array.isArray(s.events) ? s.events : [];
  s.users = s.users && typeof s.users === "object" ? s.users : {};

  for (const ev of s.events) {
    ev.status = ev.status || "active";
    ev.endDate = ev.endDate || new Date(Date.now() + 3600 * 1000).toISOString();

    // ✅ パリミューチュエル：固定賞金なし
    ev.totalStaked = Number(ev.totalStaked || 0);

    ev.options = Array.isArray(ev.options) ? ev.options : [];
    for (const o of ev.options) {
      o.id = Number(o.id);
      o.text = String(o.text ?? "");
      o.staked = Number(o.staked || 0);
    }

    ev.predictions = Array.isArray(ev.predictions) ? ev.predictions : [];
    ev.snapshots = Array.isArray(ev.snapshots) ? ev.snapshots : [];

    ev.participants = Number(ev.participants || 0);
    ev.resolvedOptionId = ev.resolvedOptionId ?? null;
    ev.resolvedAt = ev.resolvedAt ?? null;
    ev.payoutDone = Boolean(ev.payoutDone);
  }

  return s;
}

export async function loadStore() {
  const data = await kv.get(KEY);
  if (!data) {
    const init = defaultStore();
    await kv.set(KEY, init);
    return init;
  }
  const migrated = migrateStore(data);
  await kv.set(KEY, migrated);
  return migrated;
}

export async function saveStore(store) {
  await kv.set(KEY, store);
}

export function ensureUser(store, deviceId) {
  if (!store.users[deviceId]) {
    store.users[deviceId] = { name: "Guest", points: 1000 };
  } else {
    if (typeof store.users[deviceId].points !== "number") store.users[deviceId].points = 1000;
    if (!store.users[deviceId].name) store.users[deviceId].name = "Guest";
  }
  return store.users[deviceId];
}

export function isAuthorized(req) {
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (!ADMIN_KEY) return true; // デモは鍵なしOK（本番はADMIN_KEY入れる）
  const keyFromHeader = req.headers["x-admin-key"];
  const keyFromQuery = req.query?.key;
  return keyFromHeader === ADMIN_KEY || keyFromQuery === ADMIN_KEY;
}

// ✅ 確定＆分配（固定賞金なし：totalStakedのみ）
export function resolveAndPayout(store, ev, winningOptionId) {
  if (!ev || ev.status === "resolved") return;

  const winId = Number(winningOptionId);
  const winOpt = (ev.options || []).find((o) => Number(o.id) === winId);
  if (!winOpt) throw new Error("winning option not found");

  const totalPool = Number(ev.totalStaked || 0);        // ←固定賞金なし
  const winnersSum = Number(winOpt.staked || 0);

  // 勝ち側に誰も賭けてない場合、分配できない（ゼロ割）
  if (totalPool > 0 && winnersSum > 0) {
    for (const pred of ev.predictions || []) {
      if (Number(pred.optionId) !== winId) continue;

      const payout = (totalPool * Number(pred.points || 0)) / winnersSum;
      const uid = pred.deviceId;
      if (!uid) continue;

      const u = ensureUser(store, uid);
      u.points += Math.floor(payout); // 端数は切り捨て
      pred.payout = Math.floor(payout);
    }
  }

  ev.status = "resolved";
  ev.resolvedOptionId = winId;
  ev.resolvedAt = new Date().toISOString();
  ev.payoutDone = true;
}
