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

function idFromQuery() {
  return new URLSearchParams(location.search).get("id");
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
}

function calcPrices() {
  const q = (ev.options || []).map((o) => Number(o.q || 0));
  return lmsrPrices(q, ev.liquidityB || 50);
}

function getSelectedIndex() {
  return (ev.options || []).findIndex((o) => o.id === selectedOptionId);
}

// 「betポイント」を使い切る shares を逆算（cost(shares)=bet）
function sharesForBudget(q, idx, bet, b) {
  if (bet <= 0) return 0;

  let lo = 0;
  let hi = 1;

  // hi を指数的に増やし、cost >= bet となる上限を探す
  for (let k = 0; k < 30; k++) {
    const c = lmsrCostDelta(q, idx, hi, b);
    if (c >= bet) break;
    hi *= 2;
  }

  // 二分探索
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    const c = lmsrCostDelta(q, idx, mid, b);
    if (c >= bet) hi = mid;
    else lo = mid;
  }
  return hi;
}

function updateBetUI() {
  const payout = document.getElementById("payout");
  if (!payout) return;

  if (!selectedOptionId) {
    payout.textContent = "選択肢を選んでください";
    return;
  }

  const bet = Number(document.getElementById("betPoints")?.value || 0);
  if (!Number.isFinite(bet) || bet <= 0) {
    payout.textContent = "-";
    return;
  }

  const idx = getSelectedIndex();
  const q = (ev.options || []).map((o) => Number(o.q || 0));
  const b = ev.liquidityB || 50;

  const ps = lmsrPrices(q, b);
  const pRaw = ps[idx] ?? 0;
  const p = Math.min(0.999999, Math.max(0.000001, pRaw)); // ゼロ除算対策

  // 目安：当たったら（bet/p）で戻るイメージ → 純増 = bet/p - bet
  const gross = bet / p;
  const profit = Math.max(0, gross - bet);

  payout.textContent = `当たると +${Math.round(profit).toLocaleString()} pt（目安）`;
}

function renderOptions() {
  const ps = calcPrices();
  const wrap = document.getElementById("options");
  wrap.innerHTML = "";

  // resolve dropdown（管理者用）
  const sel = document.getElementById("resolveSelect");
  if (sel) {
    sel.innerHTML = "";
    (ev.options || []).forEach((o) => {
      const op = document.createElement("option");
      op.value = String(o.id);
      op.textContent = o.text;
      sel.appendChild(op);
    });
  }

  (ev.options || []).forEach((o, i) => {
    const p = ps[i];
    const pct = Math.round(p * 100);

    const card = document.createElement("div");
    card.className = "opt rounded-lg p-4 cursor-pointer";
    card.addEventListener("click", () => {
      selectedOptionId = o.id;
      document.querySelectorAll(".opt").forEach((x) => x.classList.remove("selected"));
      card.classList.add("selected");
      updateBetUI();
    });

    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="text-slate-100 font-medium">${o.text}</div>
        <div class="text-emerald-400 font-bold text-lg">${pct}%</div>
      </div>
      <div class="mt-3">
        <div class="w-full bg-slate-600 rounded-full h-2">
          <div class="h-2 rounded-full bg-emerald-500" style="width:${pct}%"></div>
        </div>
      </div>
    `;

    wrap.appendChild(card);
  });

  updateResolvedBadge();
  updateBetUI();
}

async function refresh() {
  ev = await getEventById(ev.id);
  renderMeta();
  renderOptions();
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

  document.getElementById("betPoints")?.addEventListener("input", updateBetUI);

  document.getElementById("buyBtn")?.addEventListener("click", async () => {
    const msg = document.getElementById("msg");
    msg.textContent = "";

    try {
      if (ev.status === "resolved") throw new Error("確定済みです");
      if (!selectedOptionId) throw new Error("選択肢を選んでください");

      const bet = Number(document.getElementById("betPoints")?.value || 0);
      if (!Number.isFinite(bet) || bet <= 0) throw new Error("ポイントが不正です");

      const idx = getSelectedIndex();
      if (idx < 0) throw new Error("選択肢が見つかりません");

      const q = (ev.options || []).map((o) => Number(o.q || 0));
      const b = ev.liquidityB || 50;

      // bet を使い切る shares を逆算して購入
      const shares = sharesForBudget(q, idx, bet, b);
      if (!Number.isFinite(shares) || shares <= 0) throw new Error("購入量が不正です");

      const out = await buyShares({
        eventId: ev.id,
        deviceId: auth.deviceId,
        optionId: selectedOptionId,
        shares,
      });

      document.getElementById("userPoints").textContent = out.user.points.toLocaleString();
      ev = out.event;
      msg.textContent = "賭けました！";
      renderOptions();
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

      // 同名の選択肢を追加できない（UI側ガード）
      const norm = (s) => s.trim().toLowerCase();
      const exists = (ev.options || []).some((o) => norm(o.text) === norm(text));
      if (exists) throw new Error("同じ選択肢は追加できません");

      const out = await addOption({ eventId: ev.id, deviceId: auth.deviceId, text });
      ev = out.event;
      document.getElementById("newOpt").value = "";
      msg.textContent = "追加しました！";
      renderOptions();
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
