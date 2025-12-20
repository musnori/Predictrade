// api/_kv.js
import { kv } from "@vercel/kv";

const KEY = "predictrade:store:v1";

function makeDemoEvent() {
  const now = Date.now();
  return {
    id: 1,
    title: "忘年会：ビンゴ一等は誰？",
    description: "一番最初にビンゴするのは誰だと思う？",
    category: "other",
    status: "active", // active | resolved
    endDate: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    participants: 0,
    prizePool: 1000,

    // ✅ パリミューチュエル用
    totalStaked: 0,
    options: [
      { id: 1, text: "Aさん", votes: 0, staked: 0 },
      { id: 2, text: "Bさん", votes: 0, staked: 0 },
      { id: 3, text: "Cさん", votes: 0, staked: 0 },
    ],

    // ✅ 投稿ログ（賭け）
    predictions: [],

    // ✅ 時系列のオッズ推移（line chart 用）
    // snapshots: [{ t: ISO, probs: { [optionId]: pctNumber } }]
    snapshots: [],

    // ✅ resolve情報
    resolvedOptionId: null,
    resolvedAt: null,
    payoutDone: false,
  };
}

function defaultStore() {
  return {
    events: [makeDemoEvent()],
    users: {},
  };
}

function migrateStore(store) {
  const s = store && typeof store === "object" ? store : defaultStore();
  s.events = Array.isArray(s.events) ? s.events : [];
  s.users = s.users && typeof s.users === "object" ? s.users : {};

  for (const ev of s.events) {
    ev.status = ev.status || "active";
    ev.participants = Number(ev.participants || 0);
    ev.prizePool = Number(ev.prizePool || 0);

    ev.predictions = Array.isArray(ev.predictions) ? ev.predictions : [];
    ev.snapshots = Array.isArray(ev.snapshots) ? ev.snapshots : [];
    ev.totalStaked = Number(ev.totalStaked || 0);

    ev.resolvedOptionId = ev.resolvedOptionId ?? null;
    ev.resolvedAt = ev.resolvedAt ?? null;
    ev.payoutDone = Boolean(ev.payoutDone);

    ev.options = Array.isArray(ev.options) ? ev.options : [];
    for (const o of ev.options) {
      o.id = Number(o.id);
      o.text = String(o.text ?? "");
      o.votes = Number(o.votes || 0);
      o.staked = Number(o.staked || 0);
    }
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
  // migration結果を保存しておく（後々の不整合防止）
  await kv.set(KEY, migrated);
  return migrated;
}

export async function saveStore(store) {
  await kv.set(KEY, store);
}

export function ensureUser(store, deviceId) {
  if (!store.users[deviceId]) {
    store.users[deviceId] = { name: "Guest", points: 1000 }; // 初期1000
  } else {
    if (typeof store.users[deviceId].points !== "number") store.users[deviceId].points = 1000;
    if (!store.users[deviceId].name) store.users[deviceId].name = "Guest";
  }
  return store.users[deviceId];
}

export function isAuthorized(req) {
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (!ADMIN_KEY) return true; // ✅ ローカル/デモは鍵なしでOK（必要なら false にして）
  const keyFromQuery = req.query?.key;
  const keyFromHeader = req.headers["x-admin-key"];
  return keyFromQuery === ADMIN_KEY || keyFromHeader === ADMIN_KEY;
}

// ✅ 期限到来時に「自動 resolve」する（先頭オッズ=staked最大の選択肢）
export function maybeAutoResolveEvent(store, ev) {
  if (!ev || ev.status === "resolved") return false;

  const end = new Date(ev.endDate).getTime();
  if (!Number.isFinite(end)) return false;

  const now = Date.now();
  if (now < end) return false;

  // auto resolve: staked最大（同点なら votes）
  const opts = ev.options || [];
  if (opts.length === 0) return false;

  let winner = opts[0];
  for (const o of opts) {
    if ((o.staked || 0) > (winner.staked || 0)) winner = o;
    else if ((o.staked || 0) === (winner.staked || 0) && (o.votes || 0) > (winner.votes || 0))
      winner = o;
  }

  resolveAndPayout(store, ev, winner.id, "auto");
  return true;
}

export function resolveAndPayout(store, ev, winningOptionId, mode = "manual") {
  if (!ev || ev.status === "resolved") return;

  const winId = Number(winningOptionId);
  const winOpt = (ev.options || []).find((o) => Number(o.id) === winId);
  if (!winOpt) throw new Error("winning option not found");

  // totalPool = prizePool + totalStaked（ユーザーが賭けた分も含める）
  const totalPool = Number(ev.prizePool || 0) + Number(ev.totalStaked || 0);
  const winnersSum = Number(winOpt.staked || 0);

  // winnersSum=0 のときは誰も賭けてない → 分配なし（プールは宙に浮くがデモなのでOK）
  if (winnersSum > 0) {
    for (const pred of ev.predictions || []) {
      if (Number(pred.optionId) !== winId) continue;

      const payout = (totalPool * Number(pred.points || 0)) / winnersSum;
      const uid = pred.deviceId;
      if (!uid) continue;

      const u = ensureUser(store, uid);
      u.points += Math.floor(payout); // 端数は切り捨て（簡易）
      pred.payout = Math.floor(payout);
    }
  }

  ev.status = "resolved";
  ev.resolvedOptionId = winId;
  ev.resolvedAt = new Date().toISOString();
  ev.payoutDone = true;
  ev.resolveMode = mode;
}
