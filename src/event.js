import { initAuthAndRender } from "./auth.js";
import {
  getEventById,
  submitPrediction,
  getCategoryName,
  timeRemaining,
  calcOddsFromEvent,
} from "./storage.js";

let selectedOptionId = null;
let chart = null;
let auth = null;

function getIdFromQuery() {
  const p = new URLSearchParams(location.search);
  return p.get("id");
}

function money(n) {
  return Number(n || 0).toLocaleString();
}

function setStatusBadge(ev) {
  const badge = document.getElementById("eventStatusBadge");
  if (!badge) return;

  if (ev.status === "resolved") {
    badge.textContent = "✅ 確定済み";
    badge.className = "text-sm px-2 py-1 rounded bg-emerald-500/15 text-emerald-300";
  } else {
    badge.textContent = "🟦 受付中";
    badge.className = "text-sm px-2 py-1 rounded bg-slate-700/60 text-slate-200";
  }
}

function renderOptions(ev) {
  const container = document.getElementById("predictionOptions");
  if (!container) return;

  const opts = calcOddsFromEvent(ev); // [{id,text,staked,oddsPct}]
  container.innerHTML = "";

  opts.forEach((o) => {
    const card = document.createElement("div");
    card.className = "option-card rounded-lg p-4 cursor-pointer";
    card.addEventListener("click", () => {
      selectedOptionId = o.id;
      document.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });

    const pct = Number(o.oddsPct || 0);
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="text-slate-100 font-medium">${o.text}</div>
        <div class="text-right shrink-0">
          <div class="text-emerald-400 font-bold">${pct}%</div>
          <div class="text-slate-400 text-xs">${money(o.staked)}pt</div>
        </div>
      </div>
      <div class="mt-3">
        <div class="w-full bg-slate-600 rounded-full h-2">
          <div class="h-2 rounded-full bg-emerald-500" style="width:${Math.min(100, Math.max(0, pct))}%"></div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderChart(ev) {
  const canvas = document.getElementById("chart");
  if (!canvas || !window.Chart) return;

  const options = ev.options || [];
  const snaps = Array.isArray(ev.snapshots) ? ev.snapshots : [];

  // スナップショットが無ければ「現状」を1点
  const fallbackProbs = {};
  const odds = calcOddsFromEvent(ev);
  odds.forEach((o) => (fallbackProbs[o.id] = o.oddsPct));

  const dataPoints = snaps.length
    ? snaps
    : [{ t: new Date().toISOString(), probs: fallbackProbs }];

  const labels = dataPoints.map((s) => {
    const d = new Date(s.t);
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  });

  const datasets = options.map((o) => ({
    label: o.text,
    data: dataPoints.map((s) => Number(s.probs?.[o.id] ?? 0)),
    tension: 0.25,
    borderWidth: 2,
    pointRadius: 1.5,
  }));

  if (chart) chart.destroy();
  chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#f1f5f9" } },
      },
      scales: {
        x: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(148,163,184,.15)" } },
        y: {
          suggestedMin: 0,
          suggestedMax: 100,
          ticks: { color: "#cbd5e1", callback: (v) => `${v}%` },
          grid: { color: "rgba(148,163,184,.15)" },
        },
      },
    },
  });
}

function renderEvent(ev) {
  document.getElementById("eventCategory").textContent = getCategoryName(ev.category);
  document.getElementById("eventTitle").textContent = ev.title;
  document.getElementById("eventDescription").textContent = ev.description;

  const end = new Date(ev.endDate);
  document.getElementById("eventEndDate").textContent =
    `${end.toLocaleString("ja-JP")}（${timeRemaining(ev.endDate)}）`;

  document.getElementById("participantCount").textContent = `${ev.participants || 0}人`;
  document.getElementById("prizePool").textContent = `${money(ev.prizePool)}ポイント`;
  document.getElementById("totalStaked").textContent = `${money(ev.totalStaked || 0)}pt`;

  setStatusBadge(ev);
  renderOptions(ev);
  renderChart(ev);

  const btn = document.getElementById("submitPredictionBtn");
  if (btn) {
    btn.disabled = ev.status === "resolved";
    btn.classList.toggle("opacity-50", ev.status === "resolved");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  auth = await initAuthAndRender();

  document.getElementById("backBtn")?.addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.href = "index.html";
  });

  const id = getIdFromQuery();
  if (!id) {
    document.body.innerHTML = "<div class='p-10 text-slate-100'>id がありません</div>";
    return;
  }

  let ev = await getEventById(id);
  renderEvent(ev);

  const msg = document.getElementById("msg");
  document.getElementById("submitPredictionForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";

    try {
      if (!selectedOptionId) {
        msg.textContent = "選択肢を選んでください";
        return;
      }

      const points = Number(document.getElementById("betPoints").value || 0);

      const out = await submitPrediction({
        eventId: id,
        deviceId: auth.deviceId,
        optionId: selectedOptionId,
        points,
      });

      // ヘッダのポイント更新
      const up = document.getElementById("userPoints");
      if (up) up.textContent = Number(out.user.points || 0).toLocaleString();

      ev = out.event;
      renderEvent(ev);

      msg.textContent = "投稿しました！";
    } catch (err) {
      msg.textContent = String(err?.message || err);
    }
  });
});
