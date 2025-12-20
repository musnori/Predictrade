// src/storage.js
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

export async function createEvent(payload) {
  return api("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function submitPrediction({ eventId, deviceId, optionId, points, confidence }) {
  return api(`/api/events/${eventId}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, optionId, points, confidence }),
  });
}

// 表示用ユーティリティ（既存互換）
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
  if (diff <= 0) return "終了";
  const h = Math.floor(diff / 36e5);
  const m = Math.floor((diff % 36e5) / 6e4);
  if (h < 24) return `${h}時間${m}分`;
  const d = Math.floor(h / 24);
  return `${d}日`;
}

export function calcPercentages(ev) {
  const totalVotes = (ev.options || []).reduce((s, o) => s + (o.votes || 0), 0);
  return (ev.options || []).map((o) => ({
    ...o,
    percentage: totalVotes === 0 ? 0 : Math.round((o.votes / totalVotes) * 100),
  }));
}
