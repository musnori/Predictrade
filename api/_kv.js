import { kv } from "@vercel/kv";

const KEY = "predictrade:store:v1";

function defaultStore() {
  return {
    events: [
      {
        id: 1,
        title: "忘年会：ビンゴ一等は誰？",
        description: "一番最初にビンゴするのは誰だと思う？",
        category: "other",
        status: "active",
        endDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        participants: 0,
        prizePool: 1000,
        options: [
          { id: 1, text: "Aさん", votes: 0 },
          { id: 2, text: "Bさん", votes: 0 },
          { id: 3, text: "Cさん", votes: 0 },
          { id: 4, text: "その他", votes: 0 },
        ],
        predictions: [],
      },
    ],
    users: {}, // deviceId -> { name, points }
  };
}

export async function loadStore() {
  let store = await kv.get(KEY);
  if (!store) {
    store = defaultStore();
    await kv.set(KEY, store);
  }
  return store;
}

export async function saveStore(store) {
  await kv.set(KEY, store);
}

export function ensureUser(store, deviceId) {
  if (!store.users[deviceId]) {
    store.users[deviceId] = { name: "Guest", points: 1000 }; // ★初期1000
  } else {
    if (typeof store.users[deviceId].points !== "number") store.users[deviceId].points = 1000;
    if (!store.users[deviceId].name) store.users[deviceId].name = "Guest";
  }
  return store.users[deviceId];
}
