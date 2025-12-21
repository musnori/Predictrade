import { kv } from "@vercel/kv";

const KEY = "predictrade:lmsr:v1";

function defaultStore() {
  return {
    events: [],
    users: {}, // deviceId -> { name, points }
  };
}

export async function loadStore() {
  const data = await kv.get(KEY);
  const store = data && typeof data === "object" ? data : defaultStore();
  store.events = Array.isArray(store.events) ? store.events : [];
  store.users = store.users && typeof store.users === "object" ? store.users : {};
  return store;
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

// ===== Admin auth =====
export function isAdminRequest(req) {
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (!ADMIN_KEY) return false;
  const keyFromQuery = req.query?.key;
  const keyFromHeader = req.headers["x-admin-key"];
  return keyFromQuery === ADMIN_KEY || keyFromHeader === ADMIN_KEY;
}

// ===== LMSR core =====
// C(q) = b * ln( sum_i exp(q_i / b) )
export function lmsrCost(qArr, b) {
  const B = Number(b);
  if (!Number.isFinite(B) || B <= 0) throw new Error("invalid liquidity(b)");

  const xs = qArr.map((q) => Math.exp(Number(q || 0) / B));
  const s = xs.reduce((a, v) => a + v, 0);
  return B * Math.log(s);
}

export function lmsrPrices(qArr, b) {
  const B = Number(b);
  const xs = qArr.map((q) => Math.exp(Number(q || 0) / B));
  const s = xs.reduce((a, v) => a + v, 0);
  return xs.map((v) => (s <= 0 ? 0 : v / s));
}

// costDelta = C(q + dq) - C(q)
export function lmsrCostDelta(qArr, idx, dq, b) {
  const before = lmsrCost(qArr, b);
  const afterQ = qArr.slice();
  afterQ[idx] = Number(afterQ[idx] || 0) + Number(dq || 0);
  const after = lmsrCost(afterQ, b);
  return after - before;
}

export function nowISO() {
  return new Date().toISOString();
}

export function sanitizeText(v, max = 120) {
  return String(v ?? "").trim().slice(0, max);
}
