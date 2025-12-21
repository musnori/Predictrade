import { initAuthAndRender } from "./auth.js";
import { getMyHistory } from "./storage.js";

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("ja-JP");
}

function badgeClass(outcome) {
  if (outcome === "的中") return "bg-emerald-600/20 text-emerald-200 border-emerald-600/40";
  if (outcome === "ハズレ") return "bg-red-600/15 text-red-200 border-red-600/35";
  return "bg-slate-800/40 text-slate-200 border-slate-600/30";
}

document.addEventListener("DOMContentLoaded", async () => {
  const auth = await initAuthAndRender();

  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");

  try {
    const out = await getMyHistory(auth.deviceId);
    const history = out.history || [];

    if (!history.length) {
      emptyEl.classList.remove("hidden");
      return;
    }

    listEl.innerHTML = "";
    history.forEach((h) => {
      const row = document.createElement("div");
      row.className = "card rounded-xl p-4";

      row.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-slate-300 text-xs mb-1">${h.category ?? "-"}</div>
            <div class="font-bold text-lg truncate">${h.eventTitle}</div>
            <div class="text-slate-300 text-sm mt-1">
              選択肢: <span class="text-slate-100 font-semibold">${h.optionText}</span>
            </div>
          </div>

          <div class="shrink-0 text-right">
            <div class="inline-flex px-3 py-1 rounded-full badge ${badgeClass(h.outcome)} text-sm">
              ${h.outcome}
            </div>
            <div class="text-slate-400 text-xs mt-2">${fmtDate(h.createdAt)}</div>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          <div class="bg-slate-900/30 rounded-lg px-3 py-2 border border-slate-700/50">
            <div class="text-slate-400 text-xs">使用pt</div>
            <div class="font-semibold">${Number(h.cost || 0).toLocaleString()}</div>
          </div>
          <div class="bg-slate-900/30 rounded-lg px-3 py-2 border border-slate-700/50">
            <div class="text-slate-400 text-xs">Shares</div>
            <div class="font-semibold">${Number(h.shares || 0).toFixed(3)}</div>
          </div>
          <a href="event.html?id=${encodeURIComponent(h.eventId)}"
             class="bg-slate-900/30 rounded-lg px-3 py-2 border border-slate-700/50 hover:bg-slate-900/60 text-center flex items-center justify-center font-semibold">
            イベントを見る →
          </a>
        </div>
      `;

      listEl.appendChild(row);
    });
  } catch (e) {
    emptyEl.classList.remove("hidden");
    emptyEl.textContent = `履歴の取得に失敗: ${String(e?.message || e)}`;
  }
});
