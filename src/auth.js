// src/auth.js (PM v2 - units balance)  ✅ FULL
const LS_DEVICE = "predictrade.deviceId.v1";
const LS_NAME = "predictrade.name.v1";

const UNIT_SCALE = 10000; // 10000 units = 1pt

function unitsToPoints(units) {
  const n = Number(units || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n / UNIT_SCALE);
}

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
  return res.json(); // { ok, user, balanceUnits }
}

function showNameModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(2,6,23,.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";

    overlay.innerHTML = `
      <div style="width:100%;max-width:420px;background:#0f172a;border:1px solid rgba(148,163,184,.25);border-radius:16px;padding:20px;color:#f1f5f9;">
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;">ニックネームを入力してください</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:14px;">本名じゃなくてOK（例：たろう / 営業A / うさ）</div>
        <input id="pt-name" maxlength="20"
          style="width:100%;padding:12px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.3);background:#1e293b;color:#f1f5f9;outline:none;"
          placeholder="ニックネーム（20文字まで）" />
        <button id="pt-join"
          style="margin-top:12px;width:100%;padding:12px;border-radius:12px;background:#10b981;color:white;font-weight:700;border:none;cursor:pointer;">
          はじめる
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

function renderHeader({ displayName, availableUnits, pointsFallback }) {
  const pointsEl = document.getElementById("userPoints");
  const nameEl = document.getElementById("userName");

  const pt =
    Number.isFinite(availableUnits) && availableUnits >= 0
      ? unitsToPoints(availableUnits)
      : Math.floor(Number(pointsFallback || 0));

  if (pointsEl) pointsEl.textContent = pt.toLocaleString();
  if (nameEl) nameEl.textContent = String(displayName || "");
}

function pickServerName(data, localName) {
  return String(data?.user?.displayName ?? data?.user?.name ?? localName)
    .trim()
    .slice(0, 20);
}

function pickAvailableUnits(data) {
  const v = Number(
    data?.balanceUnits?.available ??
      data?.user?.balanceUnits?.available ??
      data?.user?.available ??
      0
  );
  return Number.isFinite(v) ? v : null;
}

export async function initAuthAndRender() {
  const deviceId = getOrCreateDeviceId();

  let name = localStorage.getItem(LS_NAME);
  if (!name) {
    name = await showNameModal();
    localStorage.setItem(LS_NAME, name);
  }

  const data = await upsertUserOnServer(deviceId, name);
  const serverName = pickServerName(data, name);

  if (serverName && serverName !== name) {
    localStorage.setItem(LS_NAME, serverName);
    name = serverName;
  }

  const availableUnits = pickAvailableUnits(data);

  renderHeader({
    displayName: serverName,
    availableUnits: availableUnits ?? undefined,
    pointsFallback: data?.user?.points,
  });

  const balanceUnits = data?.balanceUnits && typeof data.balanceUnits === "object"
    ? data.balanceUnits
    : null;

  return {
    deviceId,
    name: serverName,
    pointsUnits: availableUnits, // null になり得る（混在バグ検知用）
    points: availableUnits != null ? unitsToPoints(availableUnits) : Number(data?.user?.points || 0),
    balanceUnits, // ← ✅ これを返しておく（他画面で便利）
    user: data?.user,
  };
}

// userMenu互換（rename）
export async function rename() {
  const deviceId = getOrCreateDeviceId();
  const name = await showNameModal();
  localStorage.setItem(LS_NAME, name);

  const data = await upsertUserOnServer(deviceId, name);
  const serverName = pickServerName(data, name);

  if (serverName && serverName !== name) localStorage.setItem(LS_NAME, serverName);

  const availableUnits = pickAvailableUnits(data);

  renderHeader({
    displayName: serverName,
    availableUnits: availableUnits ?? undefined,
    pointsFallback: data?.user?.points,
  });

  return data?.user;
}

export function logout() {
  localStorage.removeItem(LS_NAME);
  location.reload();
}
