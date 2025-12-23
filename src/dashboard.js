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

async function fetchAdminSnapshot(key) {
  const res = await fetch(`/api/admin/snapshot?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function renderAdminSnapshot(snapshot) {
  const usersEl = document.getElementById("adminUsers");
  const marketsEl = document.getElementById("adminMarkets");
  if (!usersEl || !marketsEl) return;

  const users = Array.isArray(snapshot?.users) ? snapshot.users : [];
  const perEvent = Array.isArray(snapshot?.perEvent) ? snapshot.perEvent : [];

  usersEl.innerHTML = users.length
    ? users
        .map(
          (u) => `
            <div class="flex items-center justify-between text-xs bg-slate-900/40 border border-slate-800 rounded-lg px-2 py-1">
              <div>
                <div>${u.displayName || u.userId}</div>
                <div class="text-[10px] text-slate-500">${u.userId}</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-slate-400">${((u.balance?.available || 0) / 10000).toFixed(2)} pt / lock ${((u.balance?.locked || 0) / 10000).toFixed(2)}</span>
                <button
                  class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px]"
                  data-action="clear-name"
                  data-user-id="${u.userId}"
                >
                  名前削除
                </button>
              </div>
            </div>`
        )
        .join("")
    : "<div class='text-xs text-slate-500'>ユーザーなし</div>";

  marketsEl.innerHTML = perEvent.length
    ? perEvent
        .map(
          (m) => `
            <div class="border border-slate-800 rounded-lg p-3 bg-slate-900/40 space-y-1 text-xs">
              <div class="font-semibold text-slate-200">${m.eventId}</div>
              <div class="text-slate-400">collateral ${((m.collateralUnits || 0) / 10000).toFixed(2)} pt</div>
              <div class="text-slate-400">orders ${m.ordersCount} / trades ${m.tradesCount}</div>
              <div class="text-slate-500">positions ${Array.isArray(m.positions) ? m.positions.length : 0}</div>
            </div>`
        )
        .join("")
    : "<div class='text-xs text-slate-500'>マーケットなし</div>";
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

  const keyInput = document.getElementById("adminKeyInput");
  const usersEl = document.getElementById("adminUsers");

  document.getElementById("adminSnapshotBtn")?.addEventListener("click", async () => {
    const msg = document.getElementById("adminSnapshotMsg");
    if (msg) msg.textContent = "";
    try {
      const key = keyInput?.value?.trim();
      if (!key) throw new Error("ADMIN_KEY required");
      const snapshot = await fetchAdminSnapshot(key);
      renderAdminSnapshot(snapshot);
    } catch (e) {
      if (msg) msg.textContent = String(e?.message || e);
    }
  });

  usersEl?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action !== "clear-name") return;
    const userId = target.dataset.userId;
    if (!userId) return;
    const key = keyInput?.value?.trim();
    if (!key) {
      const msg = document.getElementById("adminSnapshotMsg");
      if (msg) msg.textContent = "ADMIN_KEY required";
      return;
    }
    if (!confirm("このユーザーの名前を削除しますか？")) return;

    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/name?key=${encodeURIComponent(key)}`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(await res.text());
      const snapshot = await fetchAdminSnapshot(key);
      renderAdminSnapshot(snapshot);
    } catch (e) {
      const msg = document.getElementById("adminSnapshotMsg");
      if (msg) msg.textContent = String(e?.message || e);
    }
  });
});
