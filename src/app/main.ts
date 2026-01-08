/**
 * Main Page - Market Listing
 *
 * Features:
 * - Display all markets with probability
 * - Filter by category
 * - Sort by deadline/volume
 * - Auto-refresh
 */

import { storage, runAutoChecks, getDisplayPrice } from '../domain';
import { initializeDemoMarkets } from '../domain/demoData';
import type { Market } from '../domain/types';
import {
  formatTimeRemaining,
  formatUSD,
  formatPricePercent,
  sortOutcomesByPrice,
} from '../domain/helpers';

// ============================================================
// Initialize
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize demo markets if needed
  initializeDemoMarkets();

  // Run auto-checks (close expired markets, etc.)
  runAutoChecks();

  // Render initial UI
  renderUserInfo();
  renderMarkets();

  // Setup filters
  setupFilters();

  // Auto-refresh every 30 seconds
  setInterval(() => {
    runAutoChecks();
    renderMarkets();
    renderUserInfo();
  }, 30000);
});

// ============================================================
// User Info
// ============================================================

function renderUserInfo(): void {
  const user = storage.getCurrentUser();

  const nameEl = document.getElementById('userName');
  const pointsEl = document.getElementById('userPoints');

  if (nameEl) {
    nameEl.textContent = user.displayName || 'Anonymous';
  }

  if (pointsEl) {
    pointsEl.textContent = `$${user.cashBalance.toFixed(2)}`;
  }
}

// ============================================================
// Market Listing
// ============================================================

let currentCategory = '';
let currentSort = 'soon';

function setupFilters(): void {
  const categorySelect = document.getElementById('filterCategory') as HTMLSelectElement;
  const sortSelect = document.getElementById('sortBy') as HTMLSelectElement;

  if (categorySelect) {
    categorySelect.addEventListener('change', () => {
      currentCategory = categorySelect.value;
      renderMarkets();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      currentSort = sortSelect.value;
      renderMarkets();
    });
  }
}

function renderMarkets(): void {
  const grid = document.getElementById('eventsGrid');
  if (!grid) return;

  let markets = storage.getMarkets();

  // Filter by category
  if (currentCategory) {
    markets = markets.filter((m) => m.category.toLowerCase() === currentCategory.toLowerCase());
  }

  // Filter out resolved markets (show only active)
  markets = markets.filter((m) => m.status !== 'RESOLVED');

  // Sort
  if (currentSort === 'soon') {
    markets.sort((a, b) => a.endTime - b.endTime);
  } else if (currentSort === 'popular') {
    markets.sort((a, b) => b.totalVolume - a.totalVolume);
  }

  if (markets.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full text-center py-12 text-slate-400">
        <p class="text-lg">No markets found</p>
        <p class="text-sm mt-2">Check back later for new prediction markets</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = markets.map((market) => renderMarketCard(market)).join('');

  // Add click handlers
  grid.querySelectorAll('[data-market-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const marketId = (card as HTMLElement).dataset.marketId;
      window.location.href = `event.html?id=${marketId}`;
    });
  });
}

function renderMarketCard(market: Market): string {
  const sortedOutcomes = sortOutcomesByPrice(market.outcomes);
  const topOutcome = sortedOutcomes[0];

  // Get display price for top outcome
  const displayPrice = getDisplayPrice(market.id, topOutcome?.id || '');
  const probability = Math.round(displayPrice * 100);

  const timeRemaining = formatTimeRemaining(market.endTime);
  const volume = formatUSD(market.totalVolume);

  const statusBadge = getStatusBadge(market);
  const categoryColor = getCategoryColor(market.category);

  // For multi-outcome, show top candidates
  const outcomesPreview = market.type === 'MULTI_OUTCOME'
    ? sortedOutcomes.slice(0, 3).map((o) => {
        const price = getDisplayPrice(market.id, o.id);
        return `<div class="flex justify-between text-sm">
          <span class="text-slate-300">${o.label}</span>
          <span class="font-semibold text-emerald-400">${Math.round(price * 100)}%</span>
        </div>`;
      }).join('')
    : `<div class="flex items-center gap-4">
        <div class="flex-1">
          <div class="text-sm text-slate-400">Yes</div>
          <div class="text-2xl font-bold text-emerald-400">${probability}%</div>
        </div>
        <div class="flex-1">
          <div class="text-sm text-slate-400">No</div>
          <div class="text-2xl font-bold text-sky-400">${100 - probability}%</div>
        </div>
      </div>`;

  return `
    <div class="event-card card-hover rounded-2xl p-5 cursor-pointer" data-market-id="${market.id}">
      <div class="flex items-center gap-2 mb-3">
        <span class="px-2 py-1 rounded-full text-xs ${categoryColor}">${market.category}</span>
        ${statusBadge}
      </div>

      <h3 class="font-semibold text-lg line-clamp-2 mb-3">${market.question}</h3>

      <div class="mb-4">
        ${outcomesPreview}
      </div>

      <div class="flex items-center justify-between text-sm text-slate-400 pt-3 border-t border-slate-700/50">
        <span>${timeRemaining}</span>
        <span>Vol: ${volume}</span>
      </div>
    </div>
  `;
}

function getStatusBadge(market: Market): string {
  switch (market.status) {
    case 'OPEN':
      return '<span class="px-2 py-1 rounded-full text-xs bg-emerald-500/20 text-emerald-300">Open</span>';
    case 'CLOSED':
      return '<span class="px-2 py-1 rounded-full text-xs bg-amber-500/20 text-amber-300">Closed</span>';
    case 'RESOLUTION_PROPOSED':
      return '<span class="px-2 py-1 rounded-full text-xs bg-purple-500/20 text-purple-300">Pending Resolution</span>';
    case 'DISPUTED':
      return '<span class="px-2 py-1 rounded-full text-xs bg-red-500/20 text-red-300">Disputed</span>';
    case 'RESOLVED':
      return '<span class="px-2 py-1 rounded-full text-xs bg-slate-500/20 text-slate-300">Resolved</span>';
    default:
      return '';
  }
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    'Crypto': 'bg-orange-500/20 text-orange-300',
    'Finance': 'bg-blue-500/20 text-blue-300',
    'Politics': 'bg-purple-500/20 text-purple-300',
    'Sports': 'bg-green-500/20 text-green-300',
    'Tech': 'bg-cyan-500/20 text-cyan-300',
    'Entertainment': 'bg-pink-500/20 text-pink-300',
  };
  return colors[category] || 'bg-slate-500/20 text-slate-300';
}

// Export for debugging
(window as any).predictrade = {
  storage,
  renderMarkets,
};
