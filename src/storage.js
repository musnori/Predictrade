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

export async function submitPrediction({ eventId, deviceId, optionId, points }) {
  return api(`/api/events/${eventId}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, optionId, points }),
  });
}

// ✅ 管理者/手動/自動 いずれでも resolve 可能
// - optionId を渡したら「管理者が推した結果」
// - mode:"auto" を渡したら「期限到来の自動確定（先頭オッズ）」
// ADMIN_KEYが設定されている環境では adminKey が必要
export async function resolveEvent({ eventId, optionId, mode = "manual", adminKey = "" }) {
  return api(`/api/events/${eventId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminKey ? { "x-admin-key": adminKey } : {}),
    },
    body: JSON.stringify({ optionId, mode }),
  });
}

// 表示用ユーティリティ
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

// ✅ votes じゃなく「賭けポイント（staked）」でオッズ（確率）を計算
export function calcOdds(ev) {
  const total = Number(ev.totalStaked || 0);
  return (ev.options || []).map((o) => {
    const s = Number(o.staked || 0);
    const p = total <= 0 ? 0 : Math.round((s / total) * 1000) / 10; // 0.1%刻み
    return { ...o, oddsPct: p };
  });
}
