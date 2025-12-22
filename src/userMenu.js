// src/userMenu.js
import { rename, logout } from "./auth.js";

let adminSnapshotKey = "";

function ensureAdminKey() {
  let key = adminSnapshotKey;
  if (key) return key;
  key = prompt("管理者キー（ADMIN_KEY）を入力してください");
  if (!key) return "";
  adminSnapshotKey = key.trim();
  return adminSnapshotKey;
}

function openAdminSnapshot() {
  const key = ensureAdminKey();
  if (!key) return;
  // まずは最速：JSONスナップショットを開く
  window.open(`/api/admin/snapshot?key=${encodeURIComponent(key)}`, "_blank");
}

export function initUserMenu() {
  const wrap = document.getElementById("userMenu");
  if (!wrap) return;

  // 既存HTMLにリンクがあるので「置き換え」じゃなく「追記」方式にする
  // すでに追加済みなら二重追加しない
  if (!document.getElementById("btnAdmin")) {
    const div = document.createElement("div");
    div.className = "border-t border-slate-700 mt-1 pt-1";

    div.innerHTML = `
      <button id="btnAdmin" class="w-full text-left px-4 py-3 text-emerald-300 hover:bg-slate-800/80">
        管理者（snapshot）
      </button>
      <button id="btnRename" class="w-full text-left px-4 py-3 text-slate-200 hover:bg-slate-800/80">
        名前変更
      </button>
      <button id="btnLogout" class="w-full text-left px-4 py-3 text-slate-200 hover:bg-slate-800/80">
        ログアウト
      </button>
    `;

    wrap.appendChild(div);

    document.getElementById("btnAdmin")?.addEventListener("click", () => {
      openAdminSnapshot();
    });

    document.getElementById("btnRename")?.addEventListener("click", async () => {
      await rename();
    });

    document.getElementById("btnLogout")?.addEventListener("click", () => {
      if (!confirm("ログアウトしますか？")) return;
      logout();
    });
  }

  // ショートカット：Cmd/Ctrl + Shift + A
  document.addEventListener("keydown", (e) => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const mod = isMac ? e.metaKey : e.ctrlKey;

    if (mod && e.shiftKey && (e.key === "A" || e.key === "a")) {
      e.preventDefault();
      openAdminSnapshot();
    }
  });
}
