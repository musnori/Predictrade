// ✅ userMenu.js が呼ぶための互換export

export async function rename() {
  // タブ内で名前変更したい時用（飲み会では便利）
  const deviceId = getOrCreateDeviceId();
  const name = await showNameModal();
  sessionStorage.setItem(SS_NAME, name);

  const data = await upsertUserOnServer(deviceId, name);

  const user = data?.user ? { ...data.user } : { name, points: 0 };
  user.points = Number(user.points || 0);
  user.name = String(user.name || name);

  // 画面に即反映
  const pointsEl = document.getElementById("userPoints");
  if (pointsEl) pointsEl.textContent = user.points.toLocaleString();
  const nameEl = document.getElementById("userName");
  if (nameEl) nameEl.textContent = user.name;

  return user;
}

export function logout() {
  // 各自スマホ運用なら deviceId は消さない（ポイントは端末に紐づく）
  sessionStorage.removeItem(SS_NAME);
  location.reload();
}
