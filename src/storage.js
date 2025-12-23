// src/storage.js (PM v2)
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `API error: ${res.status}`);
  }
  return res.json();
}

export async function getEvents() {
  return api("/api/events");
}

export async function getEventById(id, deviceId) {
  const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : "";
  return api(`/api/events/${encodeURIComponent(id)}${qs}`);
}

/**
 * PM v2: イベント作成（YES/NO固定）
 * payload: { title, description, category, endDate }
 * adminKey: 任意（?key= 互換）
 */
export async function createEvent(payload, adminKey) {
  const url = adminKey
    ? `/api/events?key=${encodeURIComponent(adminKey)}`
    : "/api/events";
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * PM v2: 注文（Phase1は buy のみ）
 * body:
 * {
 *   deviceId,
 *   name,
 *   outcome: "YES"|"NO",
 *   side: "buy",
 *   priceBps: 0..10000,
 *   qty: integer (>0)
 * }
 */
export async function placeOrder({ eventId, ...body }) {
  return api(`/api/events/${encodeURIComponent(eventId)}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function addClarification({ eventId, text, by }, adminKey) {
  const url = adminKey
    ? `/api/events/${encodeURIComponent(eventId)}/clarify?key=${encodeURIComponent(adminKey)}`
    : `/api/events/${encodeURIComponent(eventId)}/clarify`;
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, by }),
  });
}


/**
 * PM v2: マーケット確定（後で resolve API を差し替える前提）
 * result: "YES" | "NO"
 */
export async function resolveEvent({ eventId, result }, adminKey) {
  const url = adminKey
    ? `/api/events/${encodeURIComponent(eventId)}/resolve?key=${encodeURIComponent(adminKey)}`
    : `/api/events/${encodeURIComponent(eventId)}/resolve`;
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result }),
  });
}

export async function deleteEvent(eventId, adminKey) {
  const url = adminKey
    ? `/api/events/${encodeURIComponent(eventId)}?key=${encodeURIComponent(adminKey)}`
    : `/api/events/${encodeURIComponent(eventId)}`;
  return api(url, {
    method: "POST",
  });
}

export async function getAdminEventStats(eventId, adminKey) {
  const url = adminKey
    ? `/api/events/${encodeURIComponent(eventId)}/admin?key=${encodeURIComponent(adminKey)}`
    : `/api/events/${encodeURIComponent(eventId)}/admin`;
  return api(url);
}

export function getCategoryName(category) {
  const map = {
    sports: "スポーツ",
    politics: "政治",
    tech: "テクノロジー",
    finance: "金融",
    entertainment: "エンタメ",
    other: "その他",
  };
  return map[category] || "その他";
}

export function timeRemaining(endDate) {
  const now = Date.now();
  const end = new Date(endDate).getTime();
  const diff = end - now;
  if (!Number.isFinite(end)) return "-";
  if (diff <= 0) return "終了";
  const h = Math.floor(diff / 36e5);
  const m = Math.floor((diff % 36e5) / 6e4);
  if (h < 24) return `${h}時間${m}分`;
  const d = Math.floor(h / 24);
  return `${d}日`;
}

// Phase2以降で PM v2 の履歴APIを作る（今は呼び出し側があるなら一旦残す）
export async function getMyHistory(deviceId) {
  return api(`/api/users/${encodeURIComponent(deviceId)}?action=history`);
}


export async function cancelOrder(eventId, orderId, deviceId) {
  return api(`/api/events/${encodeURIComponent(eventId)}/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
}
