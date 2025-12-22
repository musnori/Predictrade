import { initAuthAndRender } from "./auth.js";
import { getEventById, placeOrder } from "./storage.js";

let auth = null;
let eventData = null;
let outcomes = [];
let selectedOutcome = null;
let selectedSide = "YES";
let orderSide = "buy";

const palette = ["#0ea5e9", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#14b8a6"];

function idFromQuery() {
  return new URLSearchParams(location.search).get("id");
}

function isMockMode() {
  const value = new URLSearchParams(location.search).get("mock");
  return value === "1" || value === "true";
}

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function formatPctFromBps(bps) {
  if (!Number.isFinite(bps)) return "—";
  const pct = bps / 100;
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

function formatCentsFromBps(bps) {
  if (!Number.isFinite(bps)) return "—";
  const cents = bps / 100;
  return `${cents.toFixed(1).replace(/\.0$/, "")}¢`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  return Number(value).toLocaleString();
}

function formatDate(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
}

function showError(message) {
  const banner = document.getElementById("errorBanner");
  if (!banner) return;
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2400);
}

function buildOutcomeLabel(outcome) {
  if (outcome?.label) return outcome.label;
  if (outcome?.range?.lo != null && outcome?.range?.hi != null) {
    const lo = Number(outcome.range.lo).toLocaleString("en-US");
    const hi = Number(outcome.range.hi).toLocaleString("en-US");
    return `$${lo}-$${hi}`;
  }
  return outcome?.title || "—";
}

function normalizeOutcomes(ev) {
  if (!ev) return [];
  if (Array.isArray(ev.outcomes) && ev.outcomes.length) {
    return ev.outcomes.map((outcome) => {
      const yesBps = Number(outcome.yesBps ?? outcome.chanceBps ?? 0);
      const noBps = Number(outcome.noBps ?? 10000 - yesBps);
      return {
        id: String(outcome.id ?? outcome.label ?? "outcome"),
        label: buildOutcomeLabel(outcome),
        chanceBps: Number(outcome.chanceBps ?? yesBps),
        yesBps,
        noBps,
        volume: Number(outcome.volume ?? 0),
        eventId: outcome.eventId ?? ev.id,
        status: outcome.status ?? ev.status,
        range: outcome.range ?? null,
      };
    });
  }
  if (Array.isArray(ev.children) && ev.children.length) {
    return ev.children.map((child) => ({
      id: child.id,
      label: buildOutcomeLabel(child),
      chanceBps: Number(child?.prices?.yesBps ?? 0),
      yesBps: Number(child?.prices?.yesBps ?? 0),
      noBps: Number(child?.prices?.noBps ?? 0),
      volume: Number(child?.stats?.trades ?? 0),
      eventId: child.id,
      status: child.status,
      range: child.range ?? null,
    }));
  }
  return [];
}

function buildMockEvent() {
  return {
    id: "mock-gold-2025",
    title: "What price will gold close at in 2025?",
    description: "Polymarket風のレンジ市場デモです。価格帯ごとに選択できます。",
    endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 120).toISOString(),
    stats: { trades: 12450 },
    outcomes: [
      { id: "lt4000", label: "<$4,000", chanceBps: 420, yesBps: 420, noBps: 9580, volume: 1800 },
      { id: "4000-4100", label: "$4,000-$4,100", chanceBps: 860, yesBps: 860, noBps: 9140, volume: 2600 },
      { id: "4100-4200", label: "$4,100-$4,200", chanceBps: 1320, yesBps: 1320, noBps: 8680, volume: 3100 },
      { id: "4200-4300", label: "$4,200-$4,300", chanceBps: 2100, yesBps: 2100, noBps: 7900, volume: 2400 },
      { id: "4300-4400", label: "$4,300-$4,400", chanceBps: 3100, yesBps: 3100, noBps: 6900, volume: 1800 },
      { id: "gt4400", label: ">$4,400", chanceBps: 2200, yesBps: 2200, noBps: 7800, volume: 1750 },
    ],
  };
}

function renderHeader() {
  const name = auth?.name || "";
  const points = Number(auth?.points ?? 0);
  const authButtons = document.getElementById("authButtons");
  const userSummary = document.getElementById("userSummary");
  if (name && userSummary) {
    userSummary.classList.remove("hidden");
    if (authButtons) authButtons.classList.add("hidden");
  }
  const nameEl = document.getElementById("userName");
  const pointsEl = document.getElementById("userPoints");
  if (nameEl) nameEl.textContent = name || "Guest";
  if (pointsEl) pointsEl.textContent = Number.isFinite(points) ? points.toLocaleString() : "—";
}

function renderMeta() {
  const titleEl = document.getElementById("eventTitle");
  const descEl = document.getElementById("eventDesc");
  const metaEl = document.getElementById("eventMeta");
  const volEl = document.getElementById("eventVol");
  const endEl = document.getElementById("eventEnd");

  if (titleEl) titleEl.textContent = eventData?.title ?? "—";
  if (descEl) descEl.textContent = eventData?.description ?? "—";

  const volume = Number(eventData?.volume ?? eventData?.stats?.trades ?? NaN);
  const endDate = formatDate(eventData?.endDate);
  if (metaEl) metaEl.textContent = `Vol ${Number.isFinite(volume) ? formatNumber(volume) : "—"} • End date ${endDate}`;
  if (volEl) volEl.textContent = Number.isFinite(volume) ? formatNumber(volume) : "—";
  if (endEl) endEl.textContent = endDate;
}

function buildSeededSeries(seed, basePct, points = 20) {
  const seeded = Array.from(seed).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const out = [];
  for (let i = 0; i < points; i += 1) {
    const wobble = Math.sin((i + seeded) * 0.7) * 6 + Math.cos((i + seeded) * 0.4) * 3;
    const pct = clampPct(basePct + wobble);
    out.push(pct);
  }
  return out;
}

function renderChart() {
  const chart = document.getElementById("outcomeChart");
  const legend = document.getElementById("chartLegend");
  if (!chart || !legend) return;

  chart.innerHTML = "";
  legend.innerHTML = "";

  if (!outcomes.length) {
    chart.innerHTML = '<text x="50" y="20" text-anchor="middle" fill="#94a3b8" font-size="4">No chart data</text>';
    return;
  }

  const maxLines = Math.min(outcomes.length, palette.length);
  for (let i = 0; i < maxLines; i += 1) {
    const outcome = outcomes[i];
    const color = palette[i % palette.length];
    const basePct = Number(outcome.chanceBps ?? outcome.yesBps ?? 0) / 100;
    const series = buildSeededSeries(outcome.id, basePct);
    const path = series
      .map((pct, idx) => {
        const x = (idx / (series.length - 1)) * 100;
        const y = 40 - (pct / 100) * 40;
        return `${idx === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", path);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", color);
    pathEl.setAttribute("stroke-width", "1.6");
    pathEl.setAttribute("stroke-linecap", "round");
    chart.appendChild(pathEl);

    const item = document.createElement("div");
    item.className = "flex items-center gap-2";
    item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${outcome.label}`;
    legend.appendChild(item);
  }
}

function renderOutcomeRows() {
  const container = document.getElementById("outcomeRows");
  if (!container) return;
  container.innerHTML = "";

  if (!outcomes.length) {
    container.innerHTML = '<div class="px-6 py-6 text-sm text-slate-400">Outcomes are not available yet.</div>';
    return;
  }

  outcomes.forEach((outcome) => {
    const row = document.createElement("div");
    row.className = "outcome-row grid grid-cols-[minmax(0,1.3fr)_90px_120px_minmax(180px,1fr)] gap-4 items-center px-6 py-4";
    if (selectedOutcome?.id === outcome.id) row.classList.add("selected");

    row.innerHTML = `
      <div>
        <div class="font-semibold text-slate-900">${outcome.label}</div>
        <div class="text-xs text-slate-500">Range volume</div>
      </div>
      <div class="text-sm text-slate-500">${formatNumber(outcome.volume)}</div>
      <div class="text-lg font-semibold text-slate-900">${formatPctFromBps(outcome.chanceBps)}</div>
      <div class="flex flex-wrap gap-2">
        <button class="buy-yes px-3 py-2 rounded-full text-xs font-semibold btn-yes">Buy Yes ${formatCentsFromBps(outcome.yesBps)}</button>
        <button class="buy-no px-3 py-2 rounded-full text-xs font-semibold btn-no">Buy No ${formatCentsFromBps(outcome.noBps)}</button>
      </div>
    `;

    row.addEventListener("click", () => setSelectedOutcome(outcome));

    row.querySelector(".buy-yes")?.addEventListener("click", (event) => {
      event.stopPropagation();
      setSelectedOutcome(outcome, "YES");
    });

    row.querySelector(".buy-no")?.addEventListener("click", (event) => {
      event.stopPropagation();
      setSelectedOutcome(outcome, "NO");
    });

    container.appendChild(row);
  });
}

function renderTradeCard() {
  const labelEl = document.getElementById("selectedOutcomeLabel");
  const priceEl = document.getElementById("selectedPrice");
  if (labelEl) labelEl.textContent = selectedOutcome?.label ?? "—";

  const priceBps =
    selectedSide === "YES" ? selectedOutcome?.yesBps : selectedOutcome?.noBps;
  if (priceEl) priceEl.textContent = formatCentsFromBps(priceBps);

  const buyTab = document.getElementById("tradeBuyTab");
  const sellTab = document.getElementById("tradeSellTab");
  if (buyTab && sellTab) {
    if (orderSide === "buy") {
      buyTab.classList.add("tab-active");
      sellTab.classList.remove("tab-active");
    } else {
      sellTab.classList.add("tab-active");
      buyTab.classList.remove("tab-active");
    }
  }

  const yesBtn = document.getElementById("sideYesBtn");
  const noBtn = document.getElementById("sideNoBtn");
  if (yesBtn && noBtn) {
    if (selectedSide === "YES") {
      yesBtn.classList.add("side-active-yes");
      noBtn.classList.remove("side-active-no");
    } else {
      noBtn.classList.add("side-active-no");
      yesBtn.classList.remove("side-active-yes");
    }
  }
}

function setSelectedOutcome(outcome, side) {
  selectedOutcome = outcome;
  if (side) selectedSide = side;
  renderOutcomeRows();
  renderTradeCard();
}

async function submitTrade() {
  if (!selectedOutcome) {
    showToast("Select an outcome first.");
    return;
  }
  if (orderSide === "sell") {
    showToast("Sell flow is coming soon.");
    return;
  }

  const amountInput = document.getElementById("tradeAmount");
  const raw = Number(amountInput?.value ?? 0);
  const qty = Math.max(1, Math.floor(raw || 0));
  if (!Number.isFinite(qty) || qty <= 0) {
    showToast("Enter a valid amount.");
    return;
  }

  const priceBps = selectedSide === "YES" ? selectedOutcome.yesBps : selectedOutcome.noBps;

  try {
    await placeOrder({
      eventId: selectedOutcome.eventId ?? eventData?.id,
      deviceId: auth?.deviceId,
      name: auth?.name,
      outcome: selectedSide,
      side: "buy",
      priceBps: Number(priceBps ?? 0),
      qty,
    });
    showToast("Trade submitted.");
  } catch (error) {
    showToast(error?.message || "Trade failed.");
  }
}

function bindUI() {
  document.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = btn.dataset.range;
      if (range !== "ALL") {
        showToast("Time range filters are coming soon.");
      }
    });
  });

  document.getElementById("tradeBuyTab")?.addEventListener("click", () => {
    orderSide = "buy";
    renderTradeCard();
  });

  document.getElementById("tradeSellTab")?.addEventListener("click", () => {
    orderSide = "sell";
    renderTradeCard();
  });

  document.getElementById("sideYesBtn")?.addEventListener("click", () => {
    selectedSide = "YES";
    renderTradeCard();
  });

  document.getElementById("sideNoBtn")?.addEventListener("click", () => {
    selectedSide = "NO";
    renderTradeCard();
  });

  document.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const amountInput = document.getElementById("tradeAmount");
      if (!amountInput) return;
      const current = Number(amountInput.value || 0);
      const delta = btn.dataset.add === "max" ? null : Number(btn.dataset.add || 0);
      if (delta === null) {
        amountInput.value = Math.max(1, Math.floor(auth?.points ?? 1)).toString();
      } else {
        amountInput.value = Math.max(1, Math.floor(current + delta)).toString();
      }
    });
  });

  document.getElementById("tradeSubmit")?.addEventListener("click", submitTrade);
}

async function init() {
  try {
    auth = await initAuthAndRender();
    renderHeader();
  } catch (error) {
    showError("ログイン情報の取得に失敗しました。");
  }

  const id = idFromQuery();
  if (isMockMode()) {
    eventData = buildMockEvent();
  } else {
    if (!id) {
      showError("イベントIDが見つかりません。");
      return;
    }

    try {
      eventData = await getEventById(id, auth?.deviceId);
    } catch (error) {
      showError(error?.message || "イベントの取得に失敗しました。");
      return;
    }
  }

  outcomes = normalizeOutcomes(eventData);
  selectedOutcome = outcomes[0] || null;
  renderMeta();
  renderChart();
  renderOutcomeRows();
  renderTradeCard();
  bindUI();
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
