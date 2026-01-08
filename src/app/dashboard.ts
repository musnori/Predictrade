/**
 * Dashboard Page - Portfolio & Statistics
 *
 * Features:
 * - Cash balance & total equity
 * - Open positions with P&L
 * - Open orders
 * - Trading history
 * - Reset wallet option
 */

import { storage, getDisplayPrice, runAutoChecks, cancelOrder } from '../domain';
import { initializeDemoMarkets } from '../domain/demoData';
import type { Position, Order, Trade, Market } from '../domain/types';
import { formatUSD, formatDate, formatPricePercent } from '../domain/helpers';

// ============================================================
// Initialize
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initializeDemoMarkets();
  runAutoChecks();

  renderAll();

  // Auto-refresh
  setInterval(() => {
    runAutoChecks();
    renderAll();
  }, 10000);
});

// ============================================================
// Render Functions
// ============================================================

function renderAll(): void {
  renderUserInfo();
  renderStats();
  renderPositions();
  renderOpenOrders();
  renderTradeHistory();
  setupEventListeners();
}

function renderUserInfo(): void {
  const user = storage.getCurrentUser();

  const nameEl = document.getElementById('userName');
  const pointsEl = document.getElementById('userPoints');

  if (nameEl) nameEl.textContent = user.displayName || '匿名';
  if (pointsEl) pointsEl.textContent = `$${user.cashBalance.toFixed(2)}`;
}

function renderStats(): void {
  const user = storage.getCurrentUser();
  const positions = storage.getPositions({ userId: user.id });
  const trades = storage.getTrades({ userId: user.id });

  // Calculate total equity
  let positionsValue = 0;
  for (const pos of positions) {
    if (pos.shares > 0) {
      const price = getDisplayPrice(pos.marketId, pos.outcomeId);
      positionsValue += pos.shares * price;
    }
  }
  const totalEquity = user.cashBalance + user.lockedCash + positionsValue;

  // Calculate unrealized P&L
  let unrealizedPnl = 0;
  for (const pos of positions) {
    if (pos.shares > 0) {
      const price = getDisplayPrice(pos.marketId, pos.outcomeId);
      const currentValue = pos.shares * price;
      unrealizedPnl += currentValue - pos.totalCost;
    }
  }

  const container = document.getElementById('statsContainer');
  if (container) {
    container.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="card rounded-2xl p-5">
          <div class="text-sm text-slate-400">現金残高</div>
          <div class="mt-2 text-2xl font-bold text-emerald-400">${formatUSD(user.cashBalance)}</div>
        </div>
        <div class="card rounded-2xl p-5">
          <div class="text-sm text-slate-400">注文拘束額</div>
          <div class="mt-2 text-2xl font-bold text-amber-400">${formatUSD(user.lockedCash)}</div>
        </div>
        <div class="card rounded-2xl p-5">
          <div class="text-sm text-slate-400">ポジション評価額</div>
          <div class="mt-2 text-2xl font-bold text-sky-400">${formatUSD(positionsValue)}</div>
        </div>
        <div class="card rounded-2xl p-5">
          <div class="text-sm text-slate-400">総資産</div>
          <div class="mt-2 text-2xl font-bold">${formatUSD(totalEquity)}</div>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
        <div class="card rounded-2xl p-5">
          <div class="text-sm text-slate-400">含み損益</div>
          <div class="mt-2 text-xl font-bold ${unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">
            ${unrealizedPnl >= 0 ? '+' : ''}${formatUSD(unrealizedPnl)}
          </div>
        </div>
        <div class="card rounded-2xl p-5">
          <div class="text-sm text-slate-400">確定損益</div>
          <div class="mt-2 text-xl font-bold ${user.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">
            ${user.realizedPnl >= 0 ? '+' : ''}${formatUSD(user.realizedPnl)}
          </div>
        </div>
        <div class="card rounded-2xl p-5">
          <div class="text-sm text-slate-400">総取引数</div>
          <div class="mt-2 text-xl font-bold">${trades.length}</div>
        </div>
      </div>
    `;
  }
}

function renderPositions(): void {
  const user = storage.getCurrentUser();
  const positions = storage.getPositions({ userId: user.id }).filter((p) => p.shares > 0);
  const markets = storage.getMarkets();

  const container = document.getElementById('positionsContainer');
  if (!container) return;

  if (positions.length === 0) {
    container.innerHTML = `
      <div class="card rounded-2xl p-6">
        <h3 class="text-lg font-semibold mb-4">保有ポジション</h3>
        <p class="text-slate-400">オープンポジションなし</p>
        <a href="index.html" class="mt-4 inline-block text-emerald-400 hover:underline">マーケットを見る</a>
      </div>
    `;
    return;
  }

  // Group positions by market
  const positionsByMarket = new Map<string, Position[]>();
  for (const pos of positions) {
    const existing = positionsByMarket.get(pos.marketId) || [];
    existing.push(pos);
    positionsByMarket.set(pos.marketId, existing);
  }

  let html = '<div class="card rounded-2xl p-6"><h3 class="text-lg font-semibold mb-4">保有ポジション</h3>';
  html += '<div class="space-y-4">';

  for (const [marketId, marketPositions] of positionsByMarket) {
    const market = markets.find((m) => m.id === marketId);
    if (!market) continue;

    html += `
      <div class="p-4 rounded-xl bg-slate-800/50">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <a href="event.html?id=${market.id}" class="font-semibold hover:text-emerald-400 line-clamp-2">
              ${market.question}
            </a>
            <div class="text-xs text-slate-400 mt-1">${market.status}</div>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
    `;

    for (const pos of marketPositions) {
      const outcome = market.outcomes.find((o) => o.id === pos.outcomeId);
      const currentPrice = getDisplayPrice(marketId, pos.outcomeId);
      const currentValue = pos.shares * currentPrice;
      const pnl = currentValue - pos.totalCost;
      const pnlPercent = pos.totalCost > 0 ? (pnl / pos.totalCost) * 100 : 0;

      html += `
        <div class="p-3 rounded-lg bg-slate-900/50">
          <div class="text-sm text-slate-300">${outcome?.label || '不明'}</div>
          <div class="mt-1 font-semibold">${pos.shares}株</div>
          <div class="text-xs text-slate-400">
            平均: ${Math.round(pos.avgCost * 100)}¢
          </div>
          <div class="text-xs ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">
            ${pnl >= 0 ? '+' : ''}${formatUSD(pnl)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)
          </div>
        </div>
      `;
    }

    html += '</div></div>';
  }

  html += '</div></div>';
  container.innerHTML = html;
}

function renderOpenOrders(): void {
  const user = storage.getCurrentUser();
  const orders = storage.getOrders({ userId: user.id })
    .filter((o) => o.status === 'OPEN' || o.status === 'PARTIAL')
    .sort((a, b) => b.createdAt - a.createdAt);

  const markets = storage.getMarkets();

  const container = document.getElementById('ordersContainer');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `
      <div class="card rounded-2xl p-6">
        <h3 class="text-lg font-semibold mb-4">オープン注文</h3>
        <p class="text-slate-400">オープン注文なし</p>
      </div>
    `;
    return;
  }

  let html = '<div class="card rounded-2xl p-6"><h3 class="text-lg font-semibold mb-4">オープン注文</h3>';
  html += '<div class="space-y-3">';

  for (const order of orders) {
    const market = markets.find((m) => m.id === order.marketId);
    const outcome = market?.outcomes.find((o) => o.id === order.outcomeId);
    const sideColor = order.side === 'BUY' ? 'text-emerald-400' : 'text-red-400';
    const lockedAmount = order.side === 'BUY' ? order.price * order.remaining : 0;

    html += `
      <div class="flex items-center justify-between p-4 rounded-xl bg-slate-800/50">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="${sideColor} font-semibold">${order.side}</span>
            <span class="text-slate-300">${outcome?.label || '不明'}</span>
          </div>
          <div class="text-sm text-slate-400 mt-1 truncate">
            ${market?.question || '不明なマーケット'}
          </div>
          <div class="text-xs text-slate-500 mt-1">
            ${order.remaining}/${order.quantity} @ ${Math.round(order.price * 100)}¢
            ${lockedAmount > 0 ? `• 拘束: ${formatUSD(lockedAmount)}` : ''}
          </div>
        </div>
        <button class="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm shrink-0"
                data-cancel-order="${order.id}">
          キャンセル
        </button>
      </div>
    `;
  }

  html += '</div></div>';
  container.innerHTML = html;

  // Add cancel handlers
  container.querySelectorAll('[data-cancel-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderId = (btn as HTMLElement).dataset.cancelOrder!;
      const result = cancelOrder(orderId);
      if (result.success) {
        renderAll();
      } else {
        alert(result.error || '注文のキャンセルに失敗しました');
      }
    });
  });
}

function renderTradeHistory(): void {
  const user = storage.getCurrentUser();
  const trades = storage.getTrades({ userId: user.id }).slice(0, 20);
  const markets = storage.getMarkets();

  const container = document.getElementById('historyContainer');
  if (!container) return;

  if (trades.length === 0) {
    container.innerHTML = `
      <div class="card rounded-2xl p-6">
        <h3 class="text-lg font-semibold mb-4">取引履歴</h3>
        <p class="text-slate-400">取引がありません</p>
      </div>
    `;
    return;
  }

  let html = '<div class="card rounded-2xl p-6"><h3 class="text-lg font-semibold mb-4">取引履歴</h3>';
  html += '<div class="space-y-2">';

  for (const trade of trades) {
    const market = markets.find((m) => m.id === trade.marketId);
    const outcome = market?.outcomes.find((o) => o.id === trade.outcomeId);

    const isMaker = trade.makerId === user.id;
    const side = isMaker
      ? (trade.takerSide === 'BUY' ? 'SELL' : 'BUY')
      : trade.takerSide;
    const sideColor = side === 'BUY' ? 'text-emerald-400' : 'text-red-400';

    html += `
      <div class="flex items-center justify-between py-3 border-b border-slate-800/50">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="${sideColor} text-sm">${side}</span>
            <span class="text-slate-300 text-sm">${outcome?.label || ''}</span>
            <span class="text-slate-500 text-sm">${trade.quantity} @ ${Math.round(trade.price * 100)}¢</span>
          </div>
          <div class="text-xs text-slate-500 truncate">${market?.question || ''}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-sm">${formatUSD(trade.total)}</div>
          <div class="text-xs text-slate-500">${formatDate(trade.createdAt)}</div>
        </div>
      </div>
    `;
  }

  html += '</div></div>';
  container.innerHTML = html;
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners(): void {
  document.getElementById('resetWalletBtn')?.addEventListener('click', () => {
    if (confirm('デモウォレットを$1,000にリセットしますか？ポジションには影響しません。')) {
      storage.resetWallet();
      renderAll();
    }
  });

  document.getElementById('clearAllBtn')?.addEventListener('click', () => {
    if (confirm('すべてのデータを削除して最初からやり直しますか？この操作は取り消せません。')) {
      storage.clearAll();
      initializeDemoMarkets();
      renderAll();
    }
  });
}

// Export for debugging
(window as any).predictrade = { storage };
