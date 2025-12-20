import { initAuthAndRender } from "./auth.js";
import {
  getEventById,
  submitPrediction,
  getCategoryName,
  timeRemaining,
  calcVoteStats,
} from "./storage.js";

let selectedOptionId = null;
let chart = null;

function getIdFromQuery() {
  const p = new URLSearchParams(location.search);
  return p.get("id");
}

function money(n) {
  return Number(n || 0).toLocaleString();
}

function renderOptions(ev) {
  const container = document.getElementById("predictionOptions");
  container.innerHTML = "";

  const { totalVotes, rows } = calcVoteStats(ev);

  if (!rows.length) {
    container.innerHTML = `<div class="text-slate-300 text-sm">選択肢がありません（イベントデータを確認）</div>`;
    return;
  }

  rows.forEach((o) => {
    const card = document.createElement("div");
    card.className = "option-card rounded-lg p-4 cursor-pointer";
    card.addEventListener("click", () => {
      selectedOptionId = o.id;
      document.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });

    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="text-slate-100 font-medium">${o.text}</div>
        <div class="text-right shrink-0">
          <div class="text-emerald-400 font-bold">${o.pct}%</div>
          <div class="text-slate-400 text-xs">${o.votes}票</div>
        </div>
      </div>
      <div class="mt-3">
        <div class="w-full bg-slate-600 rounded-full h-2">
          <div class="h-2 rounded-full bg-emerald-500" style="width:${Math.min(100, Math.max(0, o.pct))}%"></div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });

  document.getElementById("totalVotes").textContent = `${totalVotes}回`;
}

function renderChart(ev) {
  const canvas = document.getElementById("chart");
  if (!canvas || !window.Chart) return;

  const { rows } = calcVoteStats(ev);

  const labels = rows.map((r) => r.text);
  const values = rows.map((r) => r.pct);

  if (chart) chart.destroy();
  chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "投票比率(%)", data: values, borderWidth: 1 }],
    },
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
  document.getElementById("eventTitle").textContent = ev.title ?? "-";
  document.getElementById("eventDescription").textContent = ev.description ?? "-";

  const end = new Date(ev.endDate);
  document.getElementById("eventEndDate").textContent =
    `${end.toLocaleString("ja-JP")}（${timeRemaining(ev.endDate)}）`;

  document.getElementById("participantCount").textContent = `${ev.participants || 0}人`;
  document.getElementById("prizePool").textContent = `${money(ev.prizePool || 0)}ポイント`;

  renderOptions(ev);
  renderChart(ev);

  const btn = document.getElementById("submitPredictionBtn");
  if (btn) {
    const closed = Date.now() >= new Date(ev.endDate).getTime();
    btn.disabled = closed || ev.status === "resolved";
    btn.classList.toggle("opacity-50", btn.disabled);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const auth = await initAuthAndRender();

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
      const confidence = Number(document.getElementById("confidence").value || 0);

      const out = await submitPrediction({
        eventId: id,
        deviceId: auth.deviceId,
        optionId: selectedOptionId,
        points,
        confidence,
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
