// src/auth.js
const LS_DEVICE = "predictrade.deviceId.v1";
const SS_NAME = "predictrade.sessionName.v1";

function getOrCreateDeviceId() {
  let id = localStorage.getItem(LS_DEVICE);
  if (!id) {
    id =
      globalThis.crypto?.randomUUID?.() ??
      `dev_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    localStorage.setItem(LS_DEVICE, id);
  }
  return id;
}

async function upsertUserOnServer(deviceId, name) {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, name }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { ok, user }
}

function showNameModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(2,6,23,.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";

    overlay.innerHTML = `
      <div style="width:100%;max-width:420px;background:#0f172a;border:1px solid rgba(148,163,184,.25);border-radius:16px;padding:20px;color:#f1f5f9;">
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;">ニックネームを入力してください</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:14px;">忘年会用：本名じゃなくてOK（例：たろう / 営業A / うさ）</div>
        <input id="pt-name" maxlength="20"
          style="width:100%;padding:12px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.3);background:#1e293b;color:#f1f5f9;outline:none;"
          placeholder="ニックネーム（20文字まで）" />
        <button id="pt-join"
          style="margin-top:12px;width:100%;padding:12px;border-radius:12px;background:#10b981;color:white;font-weight:700;border:none;cursor:pointer;">
          ログイン
        </button>
        <div id="pt-err" style="margin-top:10px;font-size:12px;color:#fca5a5;min-height:16px;"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector("#pt-name");
    const btn = overlay.querySelector("#pt-join");
    const err = overlay.querySelector("#pt-err");

    const submit = () => {
      const name = input.value.trim();
      if (!name) {
        err.textContent = "ニックネームを入力してください";
        return;
      }
      resolve(name);
      overlay.remove();
    };

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    setTimeout(() => input.focus(), 50);
  });
}

function renderHeader(user) {
  const pointsEl = document.getElementById("userPoints");
  if (pointsEl) pointsEl.textContent = Number(user?.points || 0).toLocaleString();

  const nameEl = document.getElementById("userName");
  if (nameEl) nameEl.textContent = String(user?.name || "");
}

async function loginFlow() {
  const deviceId = getOrCreateDeviceId();

  // ✅ 要望どおり：開いたら必ず入力させる
  const name = await showNameModal();
  sessionStorage.setItem(SS_NAME, name);

  const data = await upsertUserOnServer(deviceId, name);
  const user = data?.user ? { ...data.user } : { name, points: 0 };
  user.points = Number(user.points || 0);
  user.name = String(user.name || name);

  renderHeader(user);
  return { deviceId, user, name: user.name, points: user.points };
}

// ✅ main.js / event.js / dashboard.js が期待している名前でexport
export async function initAuthAndRender() {
  return loginFlow();
}

// ✅ userMenu.js が期待しているexport（互換）
export async function rename() {
  const deviceId = getOrCreateDeviceId();
  const name = await showNameModal();
  sessionStorage.setItem(SS_NAME, name);

  const data = await upsertUserOnServer(deviceId, name);
  const user = data?.user ? { ...data.user } : { name, points: 0 };
  user.points = Number(user.points || 0);
  user.name = String(user.name || name);

  renderHeader(user);
  return user;
}

export function logout() {
  // 各自スマホ運用：deviceIdは消さない（ポイント紐づけ維持）
  sessionStorage.removeItem(SS_NAME);
  location.reload();
}
