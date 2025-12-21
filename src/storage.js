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

export async function getEventById(id) {
  return api(`/api/events/${id}`);
}

export async function createEvent(payload, adminKey) {
  // adminKeyはローカル用：?key= でもOKにしてる
  const url = adminKey ? `/api/events?key=${encodeURIComponent(adminKey)}` : "/api/events";
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function addOption({ eventId, deviceId, text }) {
  return api(`/api/events/${eventId}/addOption`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, text }),
  });
}

export async function buyShares({ eventId, deviceId, optionId, shares }) {
  return api(`/api/events/${eventId}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, optionId, shares }),
  });
}

export async function resolveEvent({ eventId, resultOptionId }, adminKey) {
  const url = adminKey
    ? `/api/events/${eventId}/resolve?key=${encodeURIComponent(adminKey)}`
    : `/api/events/${eventId}/resolve`;
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resultOptionId }),
  });
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

// ===== client-side LMSR (for cost estimate) =====
export function lmsrPrices(qArr, b) {
  const B = Number(b);
  const xs = qArr.map((q) => Math.exp(Number(q || 0) / B));
  const s = xs.reduce((a, v) => a + v, 0);
  return xs.map((v) => (s <= 0 ? 0 : v / s));
}

export function lmsrCost(qArr, b) {
  const B = Number(b);
  const xs = qArr.map((q) => Math.exp(Number(q || 0) / B));
  const s = xs.reduce((a, v) => a + v, 0);
  return B * Math.log(s);
}

export function lmsrCostDelta(qArr, idx, dq, b) {
  const before = lmsrCost(qArr, b);
  const after = qArr.slice();
  after[idx] = Number(after[idx] || 0) + Number(dq || 0);
  return lmsrCost(after, b) - before;
}

export async function getMyHistory(deviceId) {
  return api(`/api/users/${encodeURIComponent(deviceId)}?action=history`);
}
