import { kv } from "@vercel/kv";

/**
 * PredicTrade Polymarket-style KV schema (v2)
 *
 * 目的:
 * - 単一巨大JSONを廃止（競合でポイントがズレるのを防ぐ）
 * - balances を available/locked に分けて「担保ロック」を可能に
 * - admin可視化のため index(set) を持つ（scan無しで一覧化）
 *
 * NOTE:
 * - Vercel KV(Redis) では kv.set(key, value, { ex, nx }) のような NX/EX オプションが使える例がある :contentReference[oaicite:1]{index=1}
 * - WATCHが無い環境もあるため（CASしにくい）、更新系は簡易ロックで直列化する
 */

export const PMV2 = "predictrade:pm:v2";

// ---- key builders ----
export const k = {
  // index (for admin dump)
  idxUsers: () => `${PMV2}:idx:users`, // Set of userIds
  idxEvents: () => `${PMV2}:idx:events`, // Set of eventIds

  // core entities
  user: (userId) => `${PMV2}:user:${userId}`, // { userId, displayName, createdAt }
  balance: (userId) => `${PMV2}:bal:${userId}`, // { available, locked, updatedAt }
  event: (eventId) => `${PMV2}:event:${eventId}`, // { ... }

  // polymarket-style components (Phase1=CLOB)
  order: (eventId, orderId) => `${PMV2}:order:${eventId}:${orderId}`,
  ordersByEvent: (eventId) => `${PMV2}:idx:orders:${eventId}`, // Set of orderIds
  trade: (eventId, tradeId) => `${PMV2}:trade:${eventId}:${tradeId}`,
  tradesByEvent: (eventId) => `${PMV2}:idx:trades:${eventId}`, // List or Set of tradeIds
  position: (eventId, userId) => `${PMV2}:pos:${eventId}:${userId}`, // { yesQty, noQty, ... }

  // locks
  lock: (name) => `${PMV2}:lock:${name}`,
  
  // range outcomes (parent -> children)
  childrenByParent: (parentId) => `${PMV2}:idx:children:${parentId}`, // Set of child eventIds


};

// ---- helpers ----
export function nowISO() {
  return new Date().toISOString();
}

export function sanitizeText(v, max = 120) {
  return String(v ?? "").trim().slice(0, max);
}

export function genId(prefix = "id") {
  // 例: evt_20251222_kl3p9m2a
  const t = new Date();
  const ymd =
    String(t.getFullYear()) +
    String(t.getMonth() + 1).padStart(2, "0") +
    String(t.getDate()).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ymd}_${rnd}`;
}

// ---- locking (best-effort) ----
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 簡易ロック: SET lockKey token NX EX ttlSec
 * - 獲得できなければリトライ
 * - 解放は token一致確認してからDEL（厳密なcompare-delではないが事故率を下げる）
 */
export async function withLock(lockName, fn, opts = {}) {
  const ttlSec = Number(opts.ttlSec ?? 5);
  const retries = Number(opts.retries ?? 40);
  const backoffMs = Number(opts.backoffMs ?? 50);

  const lockKey = k.lock(lockName);
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  for (let i = 0; i < retries; i++) {
    const ok = await kv.set(lockKey, token, { nx: true, ex: ttlSec }); // :contentReference[oaicite:2]{index=2}
    if (ok) break;
    await sleep(backoffMs);
  }

  const got = await kv.get(lockKey);
  if (got !== token) {
    throw new Error(`lock_busy:${lockName}`);
  }

  try {
    return await fn();
  } finally {
    // best-effort unlock
    const cur = await kv.get(lockKey);
    if (cur === token) await kv.del(lockKey);
  }
}

// ---- users ----
export async function getUser(userId) {
  if (!userId) return null;
  const u = await kv.get(k.user(userId));
  return u && typeof u === "object" ? u : null;
}

export async function ensureUser(userId, displayName = "Guest") {
  if (!userId) throw new Error("missing userId");

  const userKey = k.user(userId);
  const balKey = k.balance(userId);

  return await withLock(`user:${userId}`, async () => {
    let u = await kv.get(userKey);
    if (!u || typeof u !== "object") {
      u = {
        userId,
        displayName: sanitizeText(displayName, 32) || "Guest",
        createdAt: nowISO(),
      };
      await kv.set(userKey, u);
      await kv.sadd(k.idxUsers(), userId);

      // 初期ポイント: 1000
      const b = { available: 1000 * PRICE_SCALE, locked: 0, updatedAt: nowISO() };
      await kv.set(balKey, b);
    } else {
      // displayNameだけは更新してOK（資産主体はuserId）
      const dn = sanitizeText(displayName, 32) || u.displayName || "Guest";
      if (dn !== u.displayName) {
        u.displayName = dn;
        await kv.set(userKey, u);
      }
      // balanceが壊れてたら補正
      const b = await kv.get(balKey);
      if (!b || typeof b !== "object") {
        await kv.set(balKey, { available: 1000, locked: 0, updatedAt: nowISO() });
      }
    }
    return u;
  });
}

export async function setDisplayName(userId, displayName) {
  const u = await ensureUser(userId, displayName);
  return u;
}

// ---- balances ----
export async function getBalance(userId) {
  if (!userId) return null;
  const b = await kv.get(k.balance(userId));
  if (!b || typeof b !== "object") return { available: 0, locked: 0 };
  return {
    available: Number(b.available || 0),
    locked: Number(b.locked || 0),
  };
}

/**
 * 残高更新（必ず user lock の中で呼ぶ）
 */
async function _setBalance(userId, available, locked) {
  const b = {
    available: Number(available || 0),
    locked: Number(locked || 0),
    updatedAt: nowISO(),
  };
  if (b.available < 0 || b.locked < 0) throw new Error("negative_balance");
  await kv.set(k.balance(userId), b);
  return b;
}

/**
 * available/locked を増減（担保ロック/解放用）
 * deltaAvailable, deltaLocked は整数推奨（ポイントは整数管理）
 */
export async function adjustBalance(userId, deltaAvailable = 0, deltaLocked = 0) {
  return await withLock(`bal:${userId}`, async () => {
    await ensureUser(userId);
    const cur = await getBalance(userId);
    const nextA = cur.available + Number(deltaAvailable || 0);
    const nextL = cur.locked + Number(deltaLocked || 0);
    return await _setBalance(userId, nextA, nextL);
  });
}

/**
 * 担保ロック: available -> locked
 */
export async function lockCollateral(userId, amount) {
  const a = Number(amount || 0);
  if (!Number.isFinite(a) || a <= 0) throw new Error("invalid_amount");
  return await withLock(`bal:${userId}`, async () => {
    await ensureUser(userId);
    const cur = await getBalance(userId);
    if (cur.available < a) throw new Error("insufficient_funds");
    return await _setBalance(userId, cur.available - a, cur.locked + a);
  });
}

/**
 * 担保解放: locked -> available
 */
export async function unlockCollateral(userId, amount) {
  const a = Number(amount || 0);
  if (!Number.isFinite(a) || a <= 0) throw new Error("invalid_amount");
  return await withLock(`bal:${userId}`, async () => {
    await ensureUser(userId);
    const cur = await getBalance(userId);
    if (cur.locked < a) throw new Error("insufficient_locked");
    return await _setBalance(userId, cur.available + a, cur.locked - a);
  });
}

export async function putEvent(event) {
  if (!event || typeof event !== "object") throw new Error("invalid_event");
  const eventId = event.id || genId("evt");
  const e = { ...event, id: eventId, updatedAt: nowISO() };

  await kv.set(k.event(eventId), e);
  await kv.sadd(k.idxEvents(), eventId);

  // ✅ 親子関係のindex
  if (e.parentId) {
    await kv.sadd(k.childrenByParent(e.parentId), eventId);
  }

  return e;
}


export async function getEvent(eventId) {
  if (!eventId) return null;
  const e = await kv.get(k.event(eventId));
  return e && typeof e === "object" ? e : null;
}

export async function listUserIds() {
  const ids = await kv.smembers(k.idxUsers());
  return Array.isArray(ids) ? ids : [];
}

export async function listEventIds() {
  const ids = await kv.smembers(k.idxEvents());
  return Array.isArray(ids) ? ids : [];
}

export async function listChildEventIds(parentId) {
  const ids = await kv.smembers(k.childrenByParent(parentId));
  return Array.isArray(ids) ? ids : [];
}


/**
 * admin可視化用スナップショット（まずは index から辿る）
 */
export async function adminSnapshot({ includeUsers = true, includeEvents = true } = {}) {
  const out = {
    schema: "pmv2",
    prefix: PMV2,
    at: nowISO(),
    users: [],
    events: [],
  };

  if (includeUsers) {
    const uids = await listUserIds();
    for (const uid of uids) {
      const [u, b] = await Promise.all([getUser(uid), getBalance(uid)]);
      if (u) out.users.push({ ...u, balance: b });
    }
  }

  if (includeEvents) {
    const eids = await listEventIds();
    for (const eid of eids) {
      const e = await getEvent(eid);
      if (e) out.events.push(e);
    }
  }

  return out;
}

// ---- Admin auth (そのまま流用) ----
export function isAdminRequest(req) {
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (!ADMIN_KEY) return false;
  const keyFromQuery = req.query?.key;
  const keyFromHeader = req.headers["x-admin-key"];
  return keyFromQuery === ADMIN_KEY || keyFromHeader === ADMIN_KEY;
}

// ---- Price helpers (0..1 を安全に扱う) ----
// 価格は浮動小数の事故を避けるため basis points (0..10000) 推奨
export const PRICE_SCALE = 10000;

export function clampPriceBps(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new Error("invalid_price");
  return Math.min(PRICE_SCALE, Math.max(0, n));
}

export function bpsToProb(bps) {
  return clampPriceBps(bps) / PRICE_SCALE;
}
