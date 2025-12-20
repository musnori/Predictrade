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

// ✅ votesベースで比率を算出（バックエンド互換）
export function calcVoteStats(ev) {
  const options = Array.isArray(ev.options) ? ev.options : [];
  const rows = options.map((o) => ({
    id: Number(o.id),
    text: String(o.text ?? ""),
    votes: Number(o.votes || 0),
  }));

  const totalVotes = rows.reduce((a, b) => a + b.votes, 0);

  const withPct = rows.map((r) => ({
    ...r,
    pct: totalVotes <= 0 ? 0 : Math.round((r.votes / totalVotes) * 1000) / 10, // 0.1%
  }));

  return { totalVotes, rows: withPct };
}
