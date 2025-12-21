// src/userMenu.js
import { rename, logout } from "./auth.js";

export function initUserMenu() {
  const wrap = document.getElementById("userMenu");
  if (!wrap) return;

  // すでにUIがあるならそこに差し込んでOK
  wrap.innerHTML = `
    <button id="btnRename" class="px-3 py-2 rounded-lg bg-slate-700 text-sm">名前変更</button>
    <button id="btnLogout" class="px-3 py-2 rounded-lg bg-slate-800 text-sm">ログアウト</button>
  `;

  document.getElementById("btnRename")?.addEventListener("click", async () => {
    await rename();
  });

  document.getElementById("btnLogout")?.addEventListener("click", () => {
    if (!confirm("ログアウトしますか？")) return;
    logout();
  });
}
