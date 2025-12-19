const LS_KEYS = {
  events: "predictrade.events.v1",
  user: "predictrade.user.v1",
};

function nowIso() {
  return new Date().toISOString();
}

export function getUser() {
  const raw = localStorage.getItem(LS_KEYS.user);
  if (raw) return JSON.parse(raw);

  const user = { id: "u1", name: "あなた", points: 1250 };
  localStorage.setItem(LS_KEYS.user, JSON.stringify(user));
  return user;
}

export function setUser(user) {
  localStorage.setItem(LS_KEYS.user, JSON.stringify(user));
}

export function seedIfEmpty() {
  const raw = localStorage.getItem(LS_KEYS.events);
  if (raw) return;

  // main.js の mockEvents 相当を初期データとして投入（あなたのプロトタイプを踏襲）
  const events = [
    {
      id: 1,
      title: "2025年オスカー賞 作品賞はどの映画が受賞する？",
      description:
        "第97回アカデミー賞の作品賞に注目。今年は特に競争が激しく、複数の有力作品がノミネートされています。",
      category: "entertainment",
      status: "active",
      endDate: "2025-03-15T12:00:00",
      participants: 247,
      prizePool: 5000,
      options: [
        { id: 1, text: "『Dune: Part Two』", votes: 89 },
        { id: 2, text: "『Oppenheimer』", votes: 76 },
        { id: 3, text: "『Poor Things』", votes: 45 },
        { id: 4, text: "『Killers of the Flower Moon』", votes: 37 }
      ],
      predictions: [] // {userId, optionId, points, confidence, createdAt}
    },
    {
      id: 2,
      title: "2025年F1ドライバーズチャンピオンは誰になる？",
      description:
        "新シーズンが開幕。レッドブル、メルセデス、フェラーリの三つ巴戦が予想されます。",
      category: "sports",
      status: "active",
      endDate: "2025-11-30T18:00:00",
      participants: 189,
      prizePool: 3000,
      options: [
        { id: 1, text: "マックス・フェルスタッペン", votes: 95 },
        { id: 2, text: "ルイス・ハミルトン", votes: 47 },
        { id: 3, text: "シャルル・ルクレール", votes: 28 },
        { id: 4, text: "その他", votes: 19 }
      ],
      predictions: []
    }
  ];

  localStorage.setItem(LS_KEYS.events, JSON.stringify(events));
}

export function getEvents() {
  seedIfEmpty();
  return JSON.parse(localStorage.getItem(LS_KEYS.events));
}

export function saveEvents(events) {
  localStorage.setItem(LS_KEYS.events, JSON.stringify(events));
}

export function getEventById(id) {
  const events = getEvents();
  return events.find((e) => e.id === Number(id)) || null;
}

export function createEvent({ title, description, category, endDate, prizePool, options }) {
  const events = getEvents();
  const nextId = (events.reduce((m, e) => Math.max(m, e.id), 0) || 0) + 1;

  const event = {
    id: nextId,
    title,
    description,
    category,
    status: "active",
    endDate,
    participants: 0,
    prizePool: Number(prizePool),
    options: options.map((t, i) => ({ id: i + 1, text: t, votes: 0 })),
    predictions: []
  };

  events.unshift(event);
  saveEvents(events);
  return event;
}

export function submitPrediction({ eventId, optionId, points, confidence }) {
  const user = getUser();
  const events = getEvents();
  const ev = events.find((e) => e.id === Number(eventId));
  if (!ev) throw new Error("Event not found");

  const p = Number(points);
  if (p <= 0) throw new Error("points must be positive");
  if (user.points < p) throw new Error("Not enough points");

  // points 消費
  user.points -= p;
  setUser(user);

  // 投票反映
  const opt = ev.options.find((o) => o.id === Number(optionId));
  if (!opt) throw new Error("Option not found");
  opt.votes += 1;

  // 参加者・予想履歴
  ev.participants += 1;
  ev.predictions.unshift({
    userId: user.id,
    optionId: opt.id,
    points: p,
    confidence: Number(confidence),
    createdAt: nowIso()
  });

  saveEvents(events);
  return { user, event: ev };
}

export function calcPercentages(event) {
  const total = event.options.reduce((s, o) => s + o.votes, 0);
  return event.options.map((o) => ({
    ...o,
    percentage: total === 0 ? Math.round(100 / event.options.length) : Math.round((o.votes / total) * 100)
  }));
}

export function getCategoryName(category) {
  const map = {
    sports: "スポーツ",
    politics: "政治",
    tech: "テクノロジー",
    finance: "金融",
    entertainment: "エンターテインメント",
    other: "その他",
  };
  return map[category] || "その他";
}

export function timeRemaining(endDateIso) {
  const end = new Date(endDateIso).getTime();
  const diff = end - Date.now();
  if (diff <= 0) return "終了";
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}
