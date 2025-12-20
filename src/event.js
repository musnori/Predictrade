import { initAuthAndRender } from "./auth.js";
import {
  getEventById,
  calcPercentages,
  submitPrediction,
  getCategoryName,
  timeRemaining,
} from "./storage.js";

let selectedOptionId = null;
let chart = null;
let auth = null;

function getIdFromQuery() {
  const p = new URLSearchParams(location.search);
  return p.get("id");
}

function renderChart(ev) {
  const canvas = document.getElementById("chart");
  if (!canvas || !window.Chart) return;

  const labels = (ev.options || []).map((o) => o.text);
  const data = (ev.options || []).map((o) => o.votes || 0);

  if (chart) chart.destroy();
  chart = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data }] },
    options: {
      plugins: {
        legend: { labels: { color: "#f1f5f9" } },
      },
    },
  });
}

function selectOption(id, cardEl) {
  selectedOptionId = id;
  document.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
  cardEl.classList.add("selected");
}

function renderEvent(ev) {
  document.getElementById("eventCategory").textContent = getCategoryName(ev.category);
  document.getElementById("eventTitle").textContent = ev.title;
  document.getElementById("eventDescription").textContent = ev.description;

  document.getElementById("participantCount").textContent = `${ev.participants || 0}人`;
  document.getElementById("prizePool").textContent = `${Number(ev.prizePool || 0).toLocaleString()}ポイント`;

  const end = new Date(ev.endDate);
  document.getElementById("eventEndDate").textContent =
    `${end.toLocaleString("ja-JP")}（${timeRemaining(ev.endDate)}）`;

  // options
  const options = calcPercentages(ev);
  const container = document.getElementById("predictionOptions");
  container.innerHTML = "";

  options.forEach((o) => {
    const card = document.createElement("div");
    card.className = "option-card rounded-lg p-4 cursor-pointer";
    card.addEventListener("click", () => selectOption(o.id, card));

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="text-slate-100 font-medium">${o.text}</div>
        <div class="text-right">
          <div class="text-emerald-400 font-bold">${o.percentage}%</div>
          <div class="text-slate-400 text-sm">${o.votes}票</div>
        </div>
      </div>
      <div class="mt-3">
        <div class="w-full bg-slate-600 rounded-full h-2">
          <div class="h-2 rounded-full bg-emerald-500" style="width:${o.percentage}%"></div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });

  renderChart(ev);
}

document.addEventListener("DOMContentLoaded", async () => {
  auth = await initAuthAndRender();

  const id = getIdFromQuery();
  if (!id) {
    document.body.innerHTML = "<div class='p-10 text-slate-100'>id がありません。index から遷移してください。</div>";
    return;
  }

  let ev = await getEventById(id);
  renderEvent(ev);

  const confidence = document.getElementById("confidence");
  const confidenceValue = document.getElementById("confidenceValue");
  confidence?.addEventListener("input", (e) => (confidenceValue.textContent = e.target.value));

  const form = document.getElementById("submitPredictionForm");
  const msg = document.getElementById("msg");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";

    if (!selectedOptionId) {
      msg.textContent = "選択肢を選んでください";
      return;
    }

    const points = Number(document.getElementById("betPoints").value);
    const conf = Number(document.getElementById("confidence").value);

    try {
      const result = await submitPrediction({
        eventId: id,
        deviceId: auth.deviceId,
        optionId: selectedOptionId,
        points,
        confidence: conf,
      });

      // 右上のポイント更新
      const userPointsEl = document.getElementById("userPoints");
      if (userPointsEl) userPointsEl.textContent = result.user.points.toLocaleString();

      ev = result.event;
      renderEvent(ev);
      msg.textContent = "投稿しました！";
    } catch (err) {
      msg.textContent = String(err?.message || err);
    }
  });
});
