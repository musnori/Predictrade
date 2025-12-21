// src/dashboard.js
import { initAuthAndRender } from "./auth.js";
import { initUserMenu } from "./userMenu.js";

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function fetchUser(deviceId) {
  const res = await fetch(`/api/users/${encodeURIComponent(deviceId)}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  // 返り値が {ok:true,user} でも user単体でも吸収（移行期の保険）
  return data?.user ?? data;
}

async function fetchHistory(deviceId) {
  const res = await fetch(
    `/api/users/${encodeURIComponent(deviceId)}?action=history`
  );
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return {
    user: data?.user ?? null,
    history: Array.isArray(data?.history) ? data.history : [],
  };
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

document.addEventListener("DOMContentLoaded", async () => {
  initUserMenu();

  try {
    // ✅ ログイン（deviceId確定＆サーバUpsert）
    const auth = await initAuthAndRender();

    // ✅ ダッシュボードは「サーバを正」にする（最新ポイント＆名前）
    const me = await fetchUser(auth.deviceId);
    const points = Number(me?.points || 0);
    setText("totalPoints", points.toLocaleString());

    // ✅ 履歴を取って、参加イベント数＆予測回数を埋める
    const { history } = await fetchHistory(auth.deviceId);

    // 予測回数（trades数）
    setText("predCount", String(history.length));

    // 参加イベント数（eventIdのユニーク数）
    const eventIds = history.map((h) => h.eventId);
    setText("participatedEvents", String(uniq(eventIds).length));
  } catch (e) {
    console.error(e);
    // 失敗時も画面を壊さず最低限表示
    setText("totalPoints", "0");
    setText("participatedEvents", "-");
    setText("predCount", "-");
  }
});
