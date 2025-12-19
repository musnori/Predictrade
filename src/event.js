import { getEventById, getUser, getCategoryName, calcPercentages, submitPrediction, timeRemaining } from "./storage.js";

let selectedOptionId = null;
let chart = null;

function setUserPoints() {
  const user = getUser();
  const el = document.getElementById("userPoints");
  if (el) el.textContent = user.points.toLocaleString();
}

function getIdFromQuery() {
  const p = new URLSearchParams(location.search);
  return p.get("id");
}

function renderEvent(ev) {
  document.getElementById("eventCategory").textContent = getCategoryName(ev.category);
  document.getElementById("eventTitle").textContent = ev.title;
  document.getElementById("eventDescription").textContent = ev.description;
  document.getElementById("participantCount").textContent = `${ev.participants}人`;
  document.getElementById("prizePool").textContent = `${ev.prizePool.toLocaleString()}ポイント`;

  const end = new Date(ev.endDate);
  document.getElementById("eventEndDate").textContent =
    `${end.toLocaleString("ja-JP")}（${timeRemaining(ev.endDate)}）`;

  const options = calcPercentages(ev);
  const container = document.getElementById("predictionOptions");
  container.innerHTML = "";

  options.forEach((o) => {
    const card = document.createElement("div");
    card.className = "option-card rounded-lg p-4";
    card.onclick = () => selectOption(o.id, card);

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-5 h-5 border-2 border-slate-400 rounded-full flex items-center justify-center">
            <div class="w-2.5 h-2.5 bg-emerald-500 rounded-full ${selectedOptionId === o.id ? "" : "hidden"}"></div>
          </div>
          <span class="text-slate-100 font-medium">${o.text}</span>
        </div>
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

  renderChart(options);
}

function selectOption(id, cardEl) {
  selectedOptionId = id;

  document.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
  cardEl.classList.add("selected");

  // ラジオ丸の更新（簡易）
  document.querySelectorAll(".option-card .bg-emerald-500").forEach((dot) => dot.classList.add("hidden"));
  cardEl.querySelector(".bg-emerald-500")?.classList.remove("hidden");

  if (window.anime) {
    anime({ targets: cardEl, scale: [1, 1.02, 1], duration: 250, easing: "easeOutQuart" });
  }
}

function renderChart(options) {
  const ctx = document.getElementById("chart");
  if (!ctx || !window.Chart) return;

  const labels = options.map((o) => o.text);
  const data = options.map((o) => o.votes);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data }] },
    options: {
      plugins: { legend: { labels: { color: "#f1f5f9" } } }
    }
  });
}

function bindForm(eventId) {
  const confidence = document.getElementById("confidence");
  const confidenceValue = document.getElementById("confidenceValue");
  confidence?.addEventListener("input", (e) => (confidenceValue.textContent = e.target.value));

  const form = document.getElementById("submitPredictionForm");
  const msg = document.getElementById("msg");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    msg.textContent = "";

    if (!selectedOptionId) {
      msg.textContent = "選択肢を選んでください";
      return;
    }

    const points = Number(document.getElementById("betPoints").value);
    const conf = Number(document.getElementById("confidence").value);

    try {
      submitPrediction({ eventId, optionId: selectedOptionId, points, confidence: conf });
      setUserPoints();

      const ev = getEventById(eventId);
      renderEvent(ev);

      msg.textContent = "投稿しました！";
    } catch (err) {
      msg.textContent = err.message || "エラーが発生しました";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setUserPoints();
  const id = getIdFromQuery();
  if (!id) {
    document.body.innerHTML = "<div class='p-10'>id がありません。indexから遷移してください。</div>";
    return;
  }

  const ev = getEventById(id);
  if (!ev) {
    document.body.innerHTML = "<div class='p-10'>イベントが見つかりません。</div>";
    return;
  }

  renderEvent(ev);
  bindForm(id);
});
