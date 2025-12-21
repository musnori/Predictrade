import { initAuthAndRender } from "./auth.js";
import {
  getEventById,
  buyShares,
  addOption,
  resolveEvent,
  timeRemaining,
  lmsrPrices,
  lmsrCostDelta,
} from "./storage.js";

let auth;
let ev;
let selectedOptionId = null;
let chart = null;

function idFromQuery() {
  return new URLSearchParams(location.search).get("id");
}

function fmt(n, d = 3) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(d) : "-";
}

function updateResolvedBadge() {
  const badge = document.getElementById("resolvedBadge");
  if (!badge) return;
  if (ev.status === "resolved") {
    badge.classList.remove("hidden");
    const ans = (ev.options || []).find((o) => o.id === ev.resultOptionId)?.text ?? "-";
    badge.textContent = `確定：${ans}`;
  } else {
    badge.classList.add("hidden");
  }
}

function renderMeta() {
  const end = new Date(ev.endDate);
  document.getElementById("eventMeta").textContent =
    `${end.toLocaleString("ja-JP")}（${timeRemaining(ev.endDate)}） / ${ev.category}`;
  document.getElementById("title").textContent = ev.title ?? "-";
  document.getElementById("desc").textContent = ev.description ?? "-";
  document.getElementById("bVal").textContent = String(ev.liquidityB ?? "-");
}

function calcPrices() {
  const q = (ev.options || []).map((o) => Number(o.q || 0));
  return lmsrPrices(q, ev.liquidityB || 50);
}

function renderOptions() {
  const ps = calcPrices();
  const wrap = document.getElementById("options");
  wrap.innerHTML = "";

  // resolve dropdown
  const sel = document.getElementById("resolveSelect");
  sel.innerHTML = "";
  (ev.options || []).forEach((o) => {
    const op = document.createElement("option");
    op.value = String(o.id);
    op.textContent = o.text;
    sel.appendChild(op);
  });

  (ev.options || []).forEach((o, i) => {
    const card = document.createElement("div");
    card.className = "opt rounded-lg p-4 cursor-pointer";
    card.addEventListener("click", () => {
      selectedOptionId = o.id;
      document.querySelectorAll(".opt").forEach((x) => x.classList.remove("selected"));
      card.classList.add("selected");
      updateEstimate();
    });

    const p = ps[i];
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="text-slate-100 font-medium">${o.text}</div>
        <div class="text-right">
          <div class="text-emerald-400 font-bold">${Math.round(p * 100)}%</div>
          <div class="text-slate-400 text-xs">q=${fmt(o.q, 1)}</div>
        </div>
      </div>
      <div class="mt-3">
        <div class="w-full bg-slate-600 rounded-full h-2">
          <div class="h-2 rounded-full bg-emerald-500" style="width:${Math.round(p * 100)}%"></div>
        </div>
      </div>
      <div class="text-xs text-slate-400 mt-2">追加者: ${o.createdBy ?? "-"} / ${o.createdAt ? new Date(o.createdAt).toLocaleString("ja-JP") : "-"}</div>
    `;
    wrap.appendChild(card);
  });

  updateResolvedBadge();
  updateEstimate();
}

function updateEstimate() {
  const est = document.getElementById("estCost");
  if (!selectedOptionId) {
    est.textContent = "選択肢を選択してください";
    return;
  }
  const sh = Number(document.getElementById("shares").value || 0);
  if (!Number.isFinite(sh) || sh <= 0) {
    est.textContent = "-";
    return;
  }
  const idx = (ev.options || []).findIndex((o) => o.id === selectedOptionId);
  const q = (ev.options || []).map((o) => Number(o.q || 0));
  const cost = lmsrCostDelta(q, idx, sh, ev.liquidityB || 50);
  est.textContent = `${fmt(cost, 3)} pt（概算）`;
}

function renderChart() {
  const canvas = document.getElementById("chart");
  if (!canvas || !window.Chart) return;

  const snaps = Array.isArray(ev.snapshots) ? ev.snapshots : [];
  const labels = snaps.map((s) => {
    const dt = new Date(s.t);
    return `${dt.getHours()}:${String(dt.getMinutes()).padStart(2, "0")}`;
  });

  const datasets = (ev.options || []).map((o) => {
    const data = snaps.map((s) => (s.prices?.[o.id] ?? 0) * 100);
    return { label: o.text, data, tension: 0.25 };
  });

  if (chart) chart.destroy();
  chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#f1f5f9" } } },
      scales: {
        x: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(148,163,184,.15)" } },
        y: { ticks: { color: "#cbd5e1", callback: (v) => `${v}%` }, grid: { color: "rgba(148,163,184,.15)" } },
      },
    },
  });
}

async function refresh() {
  ev = await getEventById(ev.id);
  renderMeta();
  renderOptions();
  renderChart();
}

document.addEventListener("DOMContentLoaded", async () => {
  auth = await initAuthAndRender();

  document.getElementById("backBtn")?.addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.href = "index.html";
  });

  const id = idFromQuery();
  if (!id) {
    document.body.innerHTML = "<div class='p-10 text-slate-100'>id がありません</div>";
    return;
  }

  ev = await getEventById(id);
  renderMeta();
  renderOptions();
  renderChart();

  document.getElementById("shares")?.addEventListener("input", updateEstimate);

  document.getElementById("buyBtn")?.addEventListener("click", async () => {
    const msg = document.getElementById("msg");
    msg.textContent = "";

    try {
      if (ev.status === "resolved") throw new Error("確定済みです");
      if (!selectedOptionId) throw new Error("選択肢を選んでください");

      const shares = Number(document.getElementById("shares").value || 0);
      if (!Number.isFinite(shares) || shares <= 0) throw new Error("シェア数が不正です");

      const out = await buyShares({
        eventId: ev.id,
        deviceId: auth.deviceId,
        optionId: selectedOptionId,
        shares,
      });

      document.getElementById("userPoints").textContent = out.user.points.toLocaleString();
      ev = out.event;
      msg.textContent = "購入しました！";
      renderOptions();
      renderChart();
    } catch (e) {
      msg.textContent = String(e?.message || e);
    }
  });

  document.getElementById("addOptBtn")?.addEventListener("click", async () => {
    const msg = document.getElementById("addOptMsg");
    msg.textContent = "";
    try {
      if (ev.status === "resolved") throw new Error("確定済みです");
      const text = document.getElementById("newOpt").value.trim();
      if (!text) throw new Error("追加するテキストを入力してください");

      const out = await addOption({ eventId: ev.id, deviceId: auth.deviceId, text });
      ev = out.event;
      document.getElementById("newOpt").value = "";
      msg.textContent = "追加しました！";
      renderOptions();
      renderChart();
    } catch (e) {
      msg.textContent = String(e?.message || e);
    }
  });

  document.getElementById("resolveBtn")?.addEventListener("click", async () => {
    const msg = document.getElementById("resolveMsg");
    msg.textContent = "";
    try {
      const adminKey = document.getElementById("adminKey").value.trim();
      if (!adminKey) throw new Error("ADMIN_KEY を入力してください（デモ用）");

      const resultOptionId = Number(document.getElementById("resolveSelect").value);
      const out = await resolveEvent({ eventId: ev.id, resultOptionId }, adminKey);

      msg.textContent = `確定しました（支払い件数: ${out.payouts?.length ?? 0}）`;
      await refresh();
    } catch (e) {
      msg.textContent = String(e?.message || e);
    }
  });
});
