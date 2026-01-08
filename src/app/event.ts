/**
 * Event Page - Market Detail & Trading
 *
 * Features:
 * - Market info display
 * - Order book visualization
 * - Order placement (Buy/Sell)
 * - Position display
 * - Resolution flow (admin)
 */

import {
  storage,
  placeOrder,
  cancelOrder,
  getOrderBookSummary,
  getDisplayPrice,
  runAutoChecks,
  proposeResolution,
  disputeResolution,
  finalizeResolution,
  getResolutionStatus,
} from '../domain';
import { initializeDemoMarkets } from '../domain/demoData';
import type { Market, Order, Outcome } from '../domain/types';
import {
  formatTimeRemaining,
  formatUSD,
  formatPricePercent,
  formatPriceCents,
  formatDate,
  roundPrice,
  isMarketTradeable,
} from '../domain/helpers';

// ============================================================
// State
// ============================================================

let currentMarket: Market | null = null;
let selectedOutcome: Outcome | null = null;
let orderSide: 'BUY' | 'SELL' = 'BUY';
let orderPrice = 0.50;
let orderQuantity = 10;

// ============================================================
// Initialize
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initializeDemoMarkets();
  runAutoChecks();

  const urlParams = new URLSearchParams(window.location.search);
  const marketId = urlParams.get('id');

  if (!marketId) {
    showError('マーケットIDが指定されていません');
    return;
  }

  currentMarket = storage.getMarket(marketId);
  if (!currentMarket) {
    showError('マーケットが見つかりません');
    return;
  }

  // Select first outcome by default
  if (currentMarket.outcomes.length > 0) {
    selectedOutcome = currentMarket.outcomes[0];
  }

  // Initial render
  renderAll();
  setupEventListeners();

  // Auto-refresh
  setInterval(() => {
    runAutoChecks();
    if (currentMarket) {
      currentMarket = storage.getMarket(currentMarket.id) || currentMarket;
      renderAll();
    }
  }, 5000);
});

function showError(message: string): void {
  const main = document.querySelector('main');
  if (main) {
    main.innerHTML = `
      <div class="max-w-xl mx-auto text-center py-20">
        <p class="text-xl text-red-400">${message}</p>
        <a href="index.html" class="mt-4 inline-block text-emerald-400 hover:underline">マーケット一覧へ戻る</a>
      </div>
    `;
  }
}

// ============================================================
// Render Functions
// ============================================================

function renderAll(): void {
  if (!currentMarket) return;

  renderUserInfo();
  renderMarketInfo();
  renderOutcomes();
  renderOrderBook();
  renderPositions();
  renderMyOrders();
  renderRecentTrades();
  renderResolutionPanel();
}

function renderUserInfo(): void {
  const user = storage.getCurrentUser();
  const nameEl = document.getElementById('userName');
  const pointsEl = document.getElementById('userPoints');

  if (nameEl) nameEl.textContent = user.displayName || '匿名';
  if (pointsEl) pointsEl.textContent = `$${user.cashBalance.toFixed(2)}`;
}

function renderMarketInfo(): void {
  if (!currentMarket) return;

  // Title and description
  const titleEl = document.getElementById('title');
  const descEl = document.getElementById('desc');
  if (titleEl) titleEl.textContent = currentMarket.question;
  if (descEl) descEl.textContent = currentMarket.description;

  // Category badge
  const categoryBadge = document.getElementById('categoryBadge');
  if (categoryBadge) {
    categoryBadge.textContent = currentMarket.category;
  }

  // Status and time
  const metaEl = document.getElementById('eventMeta');
  if (metaEl) {
    const timeStr = formatTimeRemaining(currentMarket.endTime);
    metaEl.textContent = `${currentMarket.status} • 残り ${timeStr}`;
  }

  // Market time
  const timeEl = document.getElementById('marketTime');
  if (timeEl) {
    timeEl.textContent = formatTimeRemaining(currentMarket.endTime);
  }

  // Rules
  const rulesEl = document.getElementById('rulesText');
  if (rulesEl) rulesEl.textContent = currentMarket.resolutionRules;

  const sourceEl = document.getElementById('resolutionSourceText');
  if (sourceEl) sourceEl.textContent = currentMarket.resolutionSource;

  // Resolved badge
  const resolvedBadge = document.getElementById('resolvedBadge');
  if (resolvedBadge) {
    if (currentMarket.status === 'RESOLVED') {
      const winner = currentMarket.outcomes.find((o) => o.id === currentMarket?.resolvedOutcomeId);
      resolvedBadge.textContent = `確定: ${winner?.label || '不明'}`;
      resolvedBadge.classList.remove('hidden');
    } else {
      resolvedBadge.classList.add('hidden');
    }
  }

  // For binary markets, show Yes/No prices
  if (currentMarket.type === 'BINARY') {
    const yesOutcome = currentMarket.outcomes.find((o) => o.label === 'Yes');
    const noOutcome = currentMarket.outcomes.find((o) => o.label === 'No');

    if (yesOutcome) {
      const yesPrice = getDisplayPrice(currentMarket.id, yesOutcome.id);
      const yesEl = document.getElementById('marketPriceYes');
      if (yesEl) yesEl.textContent = `${Math.round(yesPrice * 100)}¢`;

      const quickYesEl = document.getElementById('quickYesPrice');
      if (quickYesEl) quickYesEl.textContent = `${Math.round(yesPrice * 100)}¢`;

      // Update probability bar
      const barEl = document.getElementById('marketYesBar');
      if (barEl) barEl.style.width = `${yesPrice * 100}%`;

      const splitText = document.getElementById('marketSplitText');
      if (splitText) splitText.textContent = `Yes ${Math.round(yesPrice * 100)}% / No ${Math.round((1 - yesPrice) * 100)}%`;
    }

    if (noOutcome) {
      const noPrice = getDisplayPrice(currentMarket.id, noOutcome.id);
      const noEl = document.getElementById('marketPriceNo');
      if (noEl) noEl.textContent = `${Math.round(noPrice * 100)}¢`;

      const quickNoEl = document.getElementById('quickNoPrice');
      if (quickNoEl) quickNoEl.textContent = `${Math.round(noPrice * 100)}¢`;
    }

    // Order book stats for YES
    if (yesOutcome) {
      const book = getOrderBookSummary(currentMarket.id, yesOutcome.id);
      const bestBidEl = document.getElementById('bestBidYes');
      const bestAskEl = document.getElementById('bestAskYes');
      const spreadEl = document.getElementById('marketSpread');
      const sourceEl = document.getElementById('displaySource');

      if (bestBidEl) bestBidEl.textContent = book.bestBid ? `${Math.round(book.bestBid * 100)}¢` : '-';
      if (bestAskEl) bestAskEl.textContent = book.bestAsk ? `${Math.round(book.bestAsk * 100)}¢` : '-';
      if (spreadEl) spreadEl.textContent = book.spread ? `${Math.round(book.spread * 100)}¢` : '-';
      if (sourceEl) sourceEl.textContent = book.midPrice ? '仲値' : (book.lastTradePrice ? '直近取引' : '初期値');
    }
  }
}

function renderOutcomes(): void {
  if (!currentMarket) return;

  // For multi-outcome markets, render outcome selector
  const ladderRows = document.getElementById('ladderRows');
  if (!ladderRows) return;

  const outcomes = currentMarket.outcomes;

  ladderRows.innerHTML = outcomes.map((outcome) => {
    const price = getDisplayPrice(currentMarket!.id, outcome.id);
    const book = getOrderBookSummary(currentMarket!.id, outcome.id);
    const isSelected = selectedOutcome?.id === outcome.id;

    return `
      <div class="grid grid-cols-3 gap-2 px-6 py-3 border-b border-slate-800/80 hover:bg-slate-800/40 cursor-pointer ${isSelected ? 'bg-emerald-900/20' : ''}"
           data-outcome-id="${outcome.id}">
        <div>
          <button class="w-full py-2 px-3 rounded-lg bg-emerald-600/20 border border-emerald-600/40 text-emerald-200 text-sm hover:bg-emerald-600/30"
                  data-action="buy" data-outcome="${outcome.id}">
            ${outcome.label}を購入
          </button>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold">${Math.round(price * 100)}¢</div>
          <div class="text-xs text-slate-400">${Math.round(price * 100)}%</div>
        </div>
        <div class="text-right">
          <button class="w-full py-2 px-3 rounded-lg bg-red-600/20 border border-red-600/40 text-red-200 text-sm hover:bg-red-600/30"
                  data-action="sell" data-outcome="${outcome.id}">
            ${outcome.label}を売却
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  ladderRows.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action as 'buy' | 'sell';
      const outcomeId = (btn as HTMLElement).dataset.outcome!;
      const outcome = currentMarket?.outcomes.find((o) => o.id === outcomeId);
      if (outcome) {
        selectedOutcome = outcome;
        orderSide = action === 'buy' ? 'BUY' : 'SELL';
        orderPrice = getDisplayPrice(currentMarket!.id, outcomeId);
        openOrderSheet();
      }
    });
  });
}

function renderOrderBook(): void {
  if (!currentMarket || currentMarket.type !== 'BINARY') return;

  const yesOutcome = currentMarket.outcomes.find((o) => o.label === 'Yes');
  const noOutcome = currentMarket.outcomes.find((o) => o.label === 'No');

  if (yesOutcome) {
    const book = getOrderBookSummary(currentMarket.id, yesOutcome.id);
    renderOrderBookColumn('yesBids', book.bids.slice(0, 6), 'bid');
    renderOrderBookColumn('yesAsks', book.asks.slice(0, 6), 'ask');
  }

  if (noOutcome) {
    const book = getOrderBookSummary(currentMarket.id, noOutcome.id);
    renderOrderBookColumn('noBids', book.bids.slice(0, 6), 'bid');
    renderOrderBookColumn('noAsks', book.asks.slice(0, 6), 'ask');
  }

  const statusEl = document.getElementById('orderbookStatus');
  if (statusEl) {
    const totalOrders = storage.getOrders({ marketId: currentMarket.id }).filter(
      (o) => o.status === 'OPEN' || o.status === 'PARTIAL'
    ).length;
    statusEl.textContent = `${totalOrders}件のオープン注文`;
  }
}

function renderOrderBookColumn(elementId: string, levels: { price: number; quantity: number }[], type: 'bid' | 'ask'): void {
  const el = document.getElementById(elementId);
  if (!el) return;

  if (levels.length === 0) {
    el.innerHTML = '<div class="text-slate-500 text-xs">注文なし</div>';
    return;
  }

  const colorClass = type === 'bid' ? 'text-emerald-400' : 'text-red-400';

  el.innerHTML = levels.map((level) => `
    <div class="flex justify-between text-sm">
      <span class="${colorClass}">${Math.round(level.price * 100)}¢</span>
      <span class="text-slate-400">${level.quantity}</span>
    </div>
  `).join('');
}

function renderPositions(): void {
  if (!currentMarket) return;

  const user = storage.getCurrentUser();
  const positions = storage.getPositions({ userId: user.id, marketId: currentMarket.id });

  // For binary markets
  if (currentMarket.type === 'BINARY') {
    const yesOutcome = currentMarket.outcomes.find((o) => o.label === 'Yes');
    const noOutcome = currentMarket.outcomes.find((o) => o.label === 'No');

    const yesPos = positions.find((p) => p.outcomeId === yesOutcome?.id);
    const noPos = positions.find((p) => p.outcomeId === noOutcome?.id);

    const posYesEl = document.getElementById('posYes');
    const posNoEl = document.getElementById('posNo');

    if (posYesEl) posYesEl.textContent = String(yesPos?.shares || 0);
    if (posNoEl) posNoEl.textContent = String(noPos?.shares || 0);

    // Calculate total value
    let totalValue = 0;
    if (yesPos && yesOutcome) {
      totalValue += yesPos.shares * getDisplayPrice(currentMarket.id, yesOutcome.id);
    }
    if (noPos && noOutcome) {
      totalValue += noPos.shares * getDisplayPrice(currentMarket.id, noOutcome.id);
    }

    const valueEl = document.getElementById('positionsValue');
    if (valueEl) valueEl.textContent = `評価額: ${formatUSD(totalValue)}`;
  }
}

function renderMyOrders(): void {
  if (!currentMarket) return;

  const user = storage.getCurrentUser();
  const orders = storage.getOrders({ userId: user.id, marketId: currentMarket.id })
    .filter((o) => o.status === 'OPEN' || o.status === 'PARTIAL')
    .sort((a, b) => b.createdAt - a.createdAt);

  const container = document.getElementById('myOrders');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `
      <div class="text-slate-200 font-semibold">マイオーダー</div>
      <div class="mt-3 text-sm text-slate-400">オープン注文なし</div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="text-slate-200 font-semibold mb-3">マイオーダー</div>
    <div class="space-y-2">
      ${orders.map((order) => {
        const outcome = currentMarket?.outcomes.find((o) => o.id === order.outcomeId);
        const sideColor = order.side === 'BUY' ? 'text-emerald-400' : 'text-red-400';
        return `
          <div class="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
            <div>
              <span class="${sideColor} font-semibold">${order.side}</span>
              <span class="text-slate-300 ml-2">${outcome?.label || '不明'}</span>
              <div class="text-xs text-slate-400">
                ${order.remaining}/${order.quantity} @ ${Math.round(order.price * 100)}¢
              </div>
            </div>
            <button class="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm"
                    data-cancel-order="${order.id}">
              キャンセル
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;

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

function renderRecentTrades(): void {
  if (!currentMarket) return;

  const trades = storage.getTrades({ marketId: currentMarket.id }).slice(0, 10);
  const container = document.getElementById('tradeRows');
  if (!container) return;

  if (trades.length === 0) {
    container.innerHTML = '<div class="text-slate-400">取引がありません</div>';
    return;
  }

  container.innerHTML = trades.map((trade) => {
    const outcome = currentMarket?.outcomes.find((o) => o.id === trade.outcomeId);
    const sideColor = trade.takerSide === 'BUY' ? 'text-emerald-400' : 'text-red-400';
    const timeAgo = getTimeAgo(trade.createdAt);

    return `
      <div class="flex items-center justify-between py-2 border-b border-slate-800/50">
        <div>
          <span class="${sideColor}">${trade.takerSide}</span>
          <span class="text-slate-300 ml-2">${outcome?.label || ''}</span>
          <span class="text-slate-400 ml-2">${trade.quantity} @ ${Math.round(trade.price * 100)}¢</span>
        </div>
        <span class="text-xs text-slate-500">${timeAgo}</span>
      </div>
    `;
  }).join('');
}

function renderResolutionPanel(): void {
  if (!currentMarket) return;

  const isAdmin = storage.isAdminMode();
  const status = getResolutionStatus(currentMarket);

  // Admin gate
  const adminGate = document.getElementById('adminGate');
  const adminPanel = document.getElementById('adminPanel');

  if (!isAdmin) {
    adminGate?.classList.remove('hidden');
    adminPanel?.classList.add('hidden');
  } else {
    adminGate?.classList.add('hidden');
    adminPanel?.classList.remove('hidden');

    // Populate resolve select
    const select = document.getElementById('adminResolveSelect') as HTMLSelectElement;
    if (select && currentMarket) {
      select.innerHTML = currentMarket.outcomes.map((o) =>
        `<option value="${o.id}">${o.label}</option>`
      ).join('');
    }
  }

  // Show dispute button if in proposal state
  if (status.canDispute && currentMarket.resolutionProposal) {
    const proposedOutcome = currentMarket.outcomes.find(
      (o) => o.id === currentMarket?.resolutionProposal?.proposedOutcomeId
    );
    const timeRemaining = status.challengeTimeRemaining
      ? Math.ceil(status.challengeTimeRemaining / 60000)
      : 0;

    const rulesUpdates = document.getElementById('rulesUpdates');
    if (rulesUpdates) {
      rulesUpdates.innerHTML = `
        <div class="p-4 rounded-lg bg-purple-900/30 border border-purple-500/40">
          <div class="font-semibold text-purple-200">確定が提案されました</div>
          <div class="mt-2 text-sm">
            提案された結果: <strong>${proposedOutcome?.label || '不明'}</strong>
          </div>
          <div class="text-sm text-slate-400">
            異議申立期間は残り${timeRemaining}分
          </div>
          <button class="mt-3 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-sm"
                  id="disputeBtn">
            異議を申し立てる
          </button>
        </div>
      `;

      document.getElementById('disputeBtn')?.addEventListener('click', () => {
        const reason = prompt('異議の理由を入力してください:');
        if (reason && currentMarket) {
          const result = disputeResolution(currentMarket.id, reason);
          if (result.success) {
            alert('異議が提出されました');
            currentMarket = storage.getMarket(currentMarket.id) || currentMarket;
            renderAll();
          } else {
            alert(result.error || '異議の申立てに失敗しました');
          }
        }
      });
    }
  }
}

// ============================================================
// Order Sheet
// ============================================================

function openOrderSheet(): void {
  const sheet = document.getElementById('sheet');
  const overlay = document.getElementById('sheetOverlay');

  if (sheet) {
    sheet.classList.remove('sheet-hidden');
    sheet.setAttribute('aria-hidden', 'false');
  }
  if (overlay) {
    overlay.classList.remove('overlay-hidden');
  }

  updateOrderSheet();
}

function closeOrderSheet(): void {
  const sheet = document.getElementById('sheet');
  const overlay = document.getElementById('sheetOverlay');

  if (sheet) {
    sheet.classList.add('sheet-hidden');
    sheet.setAttribute('aria-hidden', 'true');
  }
  if (overlay) {
    overlay.classList.add('overlay-hidden');
  }
}

function updateOrderSheet(): void {
  if (!selectedOutcome || !currentMarket) return;

  const optionText = document.getElementById('sheetOptionText');
  const sideLabel = document.getElementById('sheetSideLabel');
  const probEl = document.getElementById('sheetProb');
  const betBig = document.getElementById('betBig');
  const betInput = document.getElementById('betPoints') as HTMLInputElement;
  const payoutEl = document.getElementById('payout');

  const buyBtn = document.getElementById('orderBuyBtn');
  const sellBtn = document.getElementById('orderSellBtn');

  if (optionText) optionText.textContent = `${currentMarket.question}`;
  if (sideLabel) sideLabel.textContent = selectedOutcome.label;
  if (probEl) probEl.textContent = `${Math.round(orderPrice * 100)}¢`;

  // Update side buttons
  if (buyBtn && sellBtn) {
    if (orderSide === 'BUY') {
      buyBtn.classList.add('bg-emerald-600/40', 'border-emerald-500');
      buyBtn.classList.remove('bg-slate-800', 'border-slate-700');
      sellBtn.classList.remove('bg-red-600/40', 'border-red-500');
      sellBtn.classList.add('bg-slate-800', 'border-slate-700');
    } else {
      sellBtn.classList.add('bg-red-600/40', 'border-red-500');
      sellBtn.classList.remove('bg-slate-800', 'border-slate-700');
      buyBtn.classList.remove('bg-emerald-600/40', 'border-emerald-500');
      buyBtn.classList.add('bg-slate-800', 'border-slate-700');
    }
  }

  // Update quantity display
  if (betBig) betBig.textContent = String(orderQuantity);
  if (betInput) betInput.value = String(orderQuantity);

  // Calculate payout/cost
  const total = roundPrice(orderPrice * orderQuantity);
  const potentialReturn = orderQuantity; // $1 per share if correct

  if (payoutEl) {
    if (orderSide === 'BUY') {
      payoutEl.textContent = `コスト: $${total.toFixed(2)} | 的中時リターン: $${potentialReturn.toFixed(2)}`;
    } else {
      payoutEl.textContent = `受取額: $${total.toFixed(2)}`;
    }
  }

  // Update trade button
  const tradeBtn = document.getElementById('tradeBtn');
  if (tradeBtn) {
    tradeBtn.textContent = orderSide === 'BUY'
      ? `${selectedOutcome.label}を$${total.toFixed(2)}で購入`
      : `${selectedOutcome.label}を$${total.toFixed(2)}で売却`;
  }
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners(): void {
  // Back button
  document.getElementById('backBtn')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  // Quick buy buttons
  document.getElementById('quickYesBtn')?.addEventListener('click', () => {
    if (!currentMarket) return;
    const yesOutcome = currentMarket.outcomes.find((o) => o.label === 'Yes');
    if (yesOutcome) {
      selectedOutcome = yesOutcome;
      orderSide = 'BUY';
      orderPrice = getDisplayPrice(currentMarket.id, yesOutcome.id);
      openOrderSheet();
    }
  });

  document.getElementById('quickNoBtn')?.addEventListener('click', () => {
    if (!currentMarket) return;
    const noOutcome = currentMarket.outcomes.find((o) => o.label === 'No');
    if (noOutcome) {
      selectedOutcome = noOutcome;
      orderSide = 'BUY';
      orderPrice = getDisplayPrice(currentMarket.id, noOutcome.id);
      openOrderSheet();
    }
  });

  // Order sheet controls
  document.getElementById('sheetClose')?.addEventListener('click', closeOrderSheet);
  document.getElementById('sheetOverlay')?.addEventListener('click', closeOrderSheet);

  document.getElementById('orderBuyBtn')?.addEventListener('click', () => {
    orderSide = 'BUY';
    updateOrderSheet();
  });

  document.getElementById('orderSellBtn')?.addEventListener('click', () => {
    orderSide = 'SELL';
    updateOrderSheet();
  });

  // Quantity controls
  document.getElementById('minusBtn')?.addEventListener('click', () => {
    orderQuantity = Math.max(1, orderQuantity - 10);
    updateOrderSheet();
  });

  document.getElementById('plusBtn')?.addEventListener('click', () => {
    orderQuantity += 10;
    updateOrderSheet();
  });

  document.querySelectorAll('.quickBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const add = parseInt((btn as HTMLElement).dataset.add || '0', 10);
      orderQuantity += add;
      updateOrderSheet();
    });
  });

  document.getElementById('maxBtn')?.addEventListener('click', () => {
    const user = storage.getCurrentUser();
    if (orderSide === 'BUY') {
      orderQuantity = Math.floor(user.cashBalance / orderPrice);
    } else if (selectedOutcome && currentMarket) {
      const position = storage.getPosition(user.id, currentMarket.id, selectedOutcome.id);
      orderQuantity = position?.shares || 0;
    }
    updateOrderSheet();
  });

  const betInput = document.getElementById('betPoints') as HTMLInputElement;
  betInput?.addEventListener('input', () => {
    orderQuantity = Math.max(0, parseInt(betInput.value, 10) || 0);
    updateOrderSheet();
  });

  // Place order
  document.getElementById('tradeBtn')?.addEventListener('click', () => {
    if (!currentMarket || !selectedOutcome) return;

    if (!isMarketTradeable(currentMarket)) {
      showSheetMessage('このマーケットは取引できません');
      return;
    }

    if (orderQuantity <= 0) {
      showSheetMessage('有効な数量を入力してください');
      return;
    }

    const result = placeOrder({
      marketId: currentMarket.id,
      outcomeId: selectedOutcome.id,
      side: orderSide,
      price: orderPrice,
      quantity: orderQuantity,
    });

    if (result.success) {
      const tradesCount = result.trades?.length || 0;
      const status = result.order?.status || 'OPEN';

      let message = '';
      if (status === 'FILLED') {
        message = `注文約定！${tradesCount}件の取引が成立しました。`;
      } else if (status === 'PARTIAL') {
        message = `注文一部約定。残り${result.order?.remaining}株。`;
      } else {
        message = '注文がオーダーブックに追加されました。';
      }

      showSheetMessage(message, 'success');
      currentMarket = storage.getMarket(currentMarket.id) || currentMarket;
      renderAll();

      // Close sheet after short delay
      setTimeout(closeOrderSheet, 1500);
    } else {
      showSheetMessage(result.error || '注文に失敗しました');
    }
  });

  // Admin controls
  document.getElementById('adminKeySaveBtn')?.addEventListener('click', () => {
    const input = document.getElementById('adminKeyEntry') as HTMLInputElement;
    if (input?.value === 'admin' || input?.value === 'ADMIN') {
      storage.setAdminMode(true);
      renderAll();
    } else {
      showAdminMessage('管理者キーが無効です');
    }
  });

  document.getElementById('adminLogoutBtn')?.addEventListener('click', () => {
    storage.setAdminMode(false);
    renderAll();
  });

  document.getElementById('adminResolveBtn')?.addEventListener('click', () => {
    if (!currentMarket) return;
    const select = document.getElementById('adminResolveSelect') as HTMLSelectElement;
    const outcomeId = select?.value;

    if (!outcomeId) {
      showAdminMessage('結果を選択してください');
      return;
    }

    // First propose
    const proposeResult = proposeResolution(currentMarket.id, outcomeId);
    if (!proposeResult.success) {
      showAdminMessage(proposeResult.error || '確定の提案に失敗しました');
      return;
    }

    // For demo, immediately finalize (skip challenge period)
    const finalizeResult = finalizeResolution(currentMarket.id, outcomeId);
    if (finalizeResult.success) {
      showAdminMessage(`マーケットが確定しました！${finalizeResult.payouts?.length || 0}名のユーザーに配当されました。`, 'success');
      currentMarket = storage.getMarket(currentMarket.id) || currentMarket;
      renderAll();
    } else {
      showAdminMessage(finalizeResult.error || '確定に失敗しました');
    }
  });

  document.getElementById('adminDeleteEventBtn')?.addEventListener('click', () => {
    if (!currentMarket) return;
    if (confirm('このマーケットを削除してもよろしいですか？')) {
      storage.deleteMarket(currentMarket.id);
      window.location.href = 'index.html';
    }
  });
}

function showSheetMessage(message: string, type: 'error' | 'success' = 'error'): void {
  const msgEl = document.getElementById('sheetMsg');
  if (msgEl) {
    msgEl.textContent = message;
    msgEl.className = type === 'success' ? 'mt-3 text-sm text-emerald-400' : 'mt-3 text-sm text-amber-200';
  }
}

function showAdminMessage(message: string, type: 'error' | 'success' = 'error'): void {
  const msgEl = document.getElementById('adminResolveMsg');
  if (msgEl) {
    msgEl.textContent = message;
    msgEl.className = type === 'success' ? 'mt-2 text-sm text-emerald-400' : 'mt-2 text-sm text-amber-200';
  }
}

// ============================================================
// Utilities
// ============================================================

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'たった今';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}時間前`;
  return `${Math.floor(seconds / 86400)}日前`;
}

// Export for debugging
(window as any).predictrade = {
  storage,
  currentMarket: () => currentMarket,
  placeOrder,
  cancelOrder,
};
