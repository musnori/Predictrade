import { initAuthAndRender } from "./auth.js";
import {
  getEventById,
  submitPrediction,
  resolveEvent,
  getCategoryName,
  timeRemaining,
  calcOdds,
} from "./storage.js";

let selectedOptionId = null;
let oddsChart = null;
let auth = null;

function getIdFromQuery() {
  const p = new URLSearchParams(location.search);
  return p.get("id");
}

function money(n) {
  return Number(n || 0).toLocaleString();
}

function setStatus(ev) {
  const badge = document.getElementById("eventStatusBadge");
  const resolvedLabel = document.getElementById("resolvedLabel");
  const submitBtn = document.getElementById("submitBtn");

  if (!badge || !resolvedLabel || !submitBtn) return;

  if (ev.status === "resolved") {
    badge.textContent = "✅ 確定済み";
    badge.className = "text-sm px-2 py-1 rounded bg-emerald-500/15 text-emerald-300";
    resolvedLabel.textContent = `勝者: ${getOptionText(ev, ev.resolvedOptionId)}`;
    submitBtn.disabled = true;
    submitBtn.classList.add("opacity-50", "cursor-not-allowed");
  } else {
    badge.textContent = "🟦 受付中";
    badge.className = "text-sm px-2 py-1 rounded bg-slate-700/60 text-slate-200";
    resolvedLabel.textContent = "";
    submitBtn.disabled = false;
    submitBtn.classList.remove("opacity-50", "cursor-not-allowed");
  }
}

function getOptionText(ev, optionId) {
  const o = (ev.options || []).find((x) => Number(x.id) === Number(optionId));
  return o ? o.text : "-";
}

function selectOption(id, cardEl) {
  selectedOptionId = id;
  document.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
  cardEl.classList.add("selected");

  // resolve select も合わせる（体験が早い）
  const resolveSel = document.getElementById("resolveOption");
  if (resolveSel) resolveSel.value = String(id);
}

function renderOddsLineChart(ev) {
  const canvas = document.getElementById("oddsChart");
  if (!canvas || !window.Chart) return;

  const opts = ev.options || [];

  // snapshots が無い場合でも、現状を1点だけ出す
  const snaps = Array.isArray(ev.snapshots) && ev.snapshots.length
    ? ev.snapshots
    : [{ t: new Date().toISOString(), probs: Object.fromEntries(opts.map(o => [o.id, 0])) }];

  const labels = snaps.map((s) => {
    const d = new Date(s.t);
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  });

  const datasets = opts.map((o) => {
    const data = snaps.map((s) => Number(s.probs?.[o.id] ?? 0));
    return {
      label: o.text,
      data,
      tension: 0.25,
      pointRadius: 1.5,
      borderWidth: 2,
    };
  });

  if (oddsChart) oddsChart.destroy();
  oddsChart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: "#f1f5f9" } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`,
          },
        },
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

function renderPredictionsLog(ev, myDeviceId) {
  const el = document.getElementById("predictionsLog");
  if (!el) return;

  const list = Array.isArray(ev.predictions) ? ev.predictions : [];
  el.innerHTML = "";

  list.slice(0, 30).forEach((p) => {
    const mine = p.deviceId === myDeviceId;
    const row = document.createElement("div");
    row.className =
      "bg-slate-900/40 border border-slate-700 rounded-lg px-3 py-2 text-sm flex items-center justify-between";
    const when = new Date(p.createdAt).toLocaleString("ja-JP");
    const payout = Number(p.payout || 0);

    row.innerHTML = `
      <div class="min-w-0">
        <div class="text-slate-100 font-medium truncate">${p.name || "Guest"} ${mine ? "<span class='text-emerald-300'>(you)</span>" : ""}</div>
        <div class="text-slate-300 truncate">${getOptionText(ev, p.optionId)} ・ ${money(p.points)}pt ・ ${when}</div>
      </div>
      <div class="text-right">
        ${ev.status === "resolved"
          ? `<div class="text-emerald-300 font-semibold">${payout > 0 ? "+" + money(payout) + "pt" : "0pt"}</div>`
          : `<div class="text-slate-400">-</div>`}
      </div>
    `;
    el.appendChild(row);
  });
}

function renderResolveOptions(ev) {
  const sel = document.getElementById("resolveOption");
  if (!sel) return;
  sel.innerHTML = "";
  (ev.options || []).forEach((o) => {
    const opt = document.createElement("option");
    opt.value = String(o.id);
    opt.textContent = o.text;
    sel.appendChild(opt);
  });
}

function renderEvent(ev) {
  document.getElementById("eventCategory").textContent = getCategoryName(ev.category);
  document.getElementById("eventTitle").textContent = ev.title;
  document.getElementById("eventDescription").textContent = ev.description;

  document.getElementById("participantCount").textContent = `${ev.participants || 0}人`;
  document.getElementById("prizePool").textContent = `${money(ev.prizePool)}ポイント`;
  document.getElementById("totalStaked").textContent = `${money(ev.totalStaked)}pt`;

  const end = new Date(ev.endDate);
  document.getElementById("eventEndDate").textContent =
    `${end.toLocaleString("ja-JP")}（${timeRemaining(ev.endDate)}）`;

  setStatus(ev);

  // options（オッズ%）
  const oddsOptions = calcOdds(ev);
  const container = document.getElementById("predictionOptions");
  container.innerHTML = "";

  oddsOptions.forEach((o) => {
    const card = document.createElement("div");
    card.className = "option-card rounded-lg p-4 cursor-pointer";
    card.addEventListener("click", () => selectOption(o.id, card));

    const pct = Number(o.oddsPct || 0);
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="text-slate-100 font-medium">${o.text}</div>
        <div class="text-right">
          <div class="text-emerald-400 font-bold">${pct}%</div>
          <div class="text-slate-400 text-sm">${money(o.staked)}pt</div>
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

  renderResolveOptions(ev);
  renderOddsLineChart(ev);
  renderPredictionsLog(ev, auth?.deviceId);
}

document.addEventListener("DOMContentLoaded", async () => {
  auth = await initAuthAndRender();

  // ✅ 戻るボタン
  document.getElementById("backBtn")?.addEventListener("click", () => {
    // 履歴があれば戻る、無ければ index
    if (history.length > 1) history.back();
    else location.href = "index.html";
  });

  const id = getIdFromQuery();
  if (!id) {
    document.body.innerHTML =
      "<div class='p-10 text-slate-100'>id がありません。index から遷移してください。</div>";
    return;
  }

  let ev = await getEventById(id);
  renderEvent(ev);

  const form = document.getElementById("submitPredictionForm");
  const msg = document.getElementById("msg");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";

    try {
      if (!selectedOptionId) {
        msg.textContent = "選択肢を選んでください";
        return;
      }

      const points = Number(document.getElementById("points").value || 0);
      const result = await submitPrediction({
        eventId: id,
        deviceId: auth.deviceId,
        optionId: selectedOptionId,
        points,
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

  // ✅ resolve: pick
  const resolveMsg = document.getElementById("resolveMsg");
  const adminKeyInput = document.getElementById("adminKey");
  document.getElementById("resolvePickBtn")?.addEventListener("click", async () => {
    resolveMsg.textContent = "";
    try {
      const optId = Number(document.getElementById("resolveOption").value);
      const adminKey = (adminKeyInput?.value || "").trim();
      const out = await resolveEvent({ eventId: id, optionId: optId, mode: "manual", adminKey });
      ev = out.event;
      renderEvent(ev);

      // 自分のポイント更新（payout反映）
      const latestUser = await fetch(`/api/users/${auth.deviceId}`).then((r) => r.json());
      const userPointsEl = document.getElementById("userPoints");
      if (userPointsEl) userPointsEl.textContent = Number(latestUser.points || 0).toLocaleString();

      resolveMsg.textContent = "確定＆分配しました。";
    } catch (err) {
      resolveMsg.textContent = String(err?.message || err);
    }
  });

  // ✅ resolve: auto (leader odds)
  document.getElementById("resolveAutoBtn")?.addEventListener("click", async () => {
    resolveMsg.textContent = "";
    try {
      const adminKey = (adminKeyInput?.value || "").trim();
      const out = await resolveEvent({ eventId: id, mode: "auto", adminKey });
      ev = out.event;
      renderEvent(ev);

      const latestUser = await fetch(`/api/users/${auth.deviceId}`).then((r) => r.json());
      const userPointsEl = document.getElementById("userPoints");
      if (userPointsEl) userPointsEl.textContent = Number(latestUser.points || 0).toLocaleString();

      resolveMsg.textContent = "先頭オッズで確定＆分配しました。";
    } catch (err) {
      resolveMsg.textContent = String(err?.message || err);
    }
  });
});
