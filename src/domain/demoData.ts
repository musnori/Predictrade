/**
 * Demo Data - Initialize demo markets and seed orders
 */

import { storage } from './storage';
import { createMarket, generateUserId } from './helpers';
import { placeOrder } from './matchingEngine';
import type { Market, User } from './types';

// ============================================================
// Demo Markets
// ============================================================

const DEMO_MARKETS: Omit<Parameters<typeof createMarket>[0], 'endTime'>[] = [
  // Binary Market 1
  {
    question: 'Will Bitcoin exceed $150,000 by end of 2026?',
    description: 'This market resolves to "Yes" if the price of Bitcoin (BTC) exceeds $150,000 USD on any major exchange (Coinbase, Binance, Kraken) at any point before December 31, 2026 23:59:59 UTC.',
    type: 'BINARY',
    outcomes: [{ label: 'Yes' }, { label: 'No' }],
    category: 'Crypto',
    resolutionSource: 'CoinGecko / CoinMarketCap',
    resolutionRules: 'Resolves Yes if BTC price exceeds $150,000 on any major exchange. Price must be sustained for at least 1 hour.',
  },
  // Binary Market 2
  {
    question: 'Will the Fed cut interest rates in Q1 2026?',
    description: 'This market resolves to "Yes" if the Federal Reserve announces at least one interest rate cut during Q1 2026 (January 1 - March 31).',
    type: 'BINARY',
    outcomes: [{ label: 'Yes' }, { label: 'No' }],
    category: 'Finance',
    resolutionSource: 'Federal Reserve Official Announcements',
    resolutionRules: 'Resolves Yes if the Fed announces any rate cut in Q1 2026. Resolves No if rates stay unchanged or increase.',
  },
  // Multi-Outcome Market
  {
    question: 'Who will win the 2028 US Presidential Election?',
    description: 'This market will resolve based on who wins the 2028 United States Presidential Election. The winner is determined by receiving 270 or more electoral votes.',
    type: 'MULTI_OUTCOME',
    outcomes: [
      { label: 'Republican Nominee' },
      { label: 'Democratic Nominee' },
      { label: 'Independent/Other' },
    ],
    category: 'Politics',
    resolutionSource: 'Associated Press / Official Electoral College Results',
    resolutionRules: 'Resolves to the candidate who wins 270+ electoral votes. If no candidate reaches 270, resolves based on House of Representatives decision.',
  },
];

// ============================================================
// Seed Functions
// ============================================================

/**
 * Initialize demo markets if none exist
 */
export function initializeDemoMarkets(): void {
  const existingMarkets = storage.getMarkets();

  // Only initialize if no markets exist
  if (existingMarkets.length > 0) {
    console.log('Markets already exist, skipping initialization');
    return;
  }

  console.log('Initializing demo markets...');

  // Create markets with different end times
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;

  const endTimes = [
    now + oneWeek,      // BTC market - 1 week
    now + oneMonth,     // Fed market - 1 month
    now + 365 * oneDay, // Election - 1 year
  ];

  for (let i = 0; i < DEMO_MARKETS.length; i++) {
    const marketConfig = DEMO_MARKETS[i];
    const market = createMarket({
      ...marketConfig,
      endTime: endTimes[i],
    });
    storage.addMarket(market);
    console.log(`Created market: ${market.question}`);

    // Seed some initial orders
    seedMarketOrders(market);
  }

  console.log('Demo markets initialized successfully');
}

/**
 * Seed a market with initial orders to provide liquidity
 */
function seedMarketOrders(market: Market): void {
  // Create bot users for seeding
  const botUsers: User[] = [];
  for (let i = 0; i < 3; i++) {
    const bot: User = {
      id: `bot_${i}_${Date.now()}`,
      displayName: `MarketMaker${i + 1}`,
      cashBalance: 100000, // Bots have lots of cash
      lockedCash: 0,
      realizedPnl: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    botUsers.push(bot);
    storage.updateUser(bot);

    // Give bots some initial shares in each outcome
    for (const outcome of market.outcomes) {
      storage.updatePosition({
        userId: bot.id,
        marketId: market.id,
        outcomeId: outcome.id,
        shares: 1000,
        avgCost: 0.50,
        totalCost: 500,
        updatedAt: Date.now(),
      });
    }
  }

  // Save current user
  const currentUser = storage.getCurrentUser();

  // Place seed orders for each outcome
  for (const outcome of market.outcomes) {
    const basePrice = market.type === 'BINARY'
      ? (outcome.label === 'Yes' ? 0.50 : 0.50)
      : 1 / market.outcomes.length;

    // Place bids (buy orders) below base price
    for (let i = 0; i < 3; i++) {
      const bot = botUsers[i];
      switchToUser(bot.id);

      const bidPrice = Math.max(0.01, basePrice - 0.05 - (i * 0.05));
      placeOrder({
        marketId: market.id,
        outcomeId: outcome.id,
        side: 'BUY',
        price: bidPrice,
        quantity: 50 + (i * 25),
      });
    }

    // Place asks (sell orders) above base price
    for (let i = 0; i < 3; i++) {
      const bot = botUsers[i];
      switchToUser(bot.id);

      const askPrice = Math.min(0.99, basePrice + 0.05 + (i * 0.05));
      placeOrder({
        marketId: market.id,
        outcomeId: outcome.id,
        side: 'SELL',
        price: askPrice,
        quantity: 50 + (i * 25),
      });
    }
  }

  // Restore current user
  switchToUser(currentUser.id);
}

/**
 * Switch the current user (for seeding)
 */
function switchToUser(userId: string): void {
  const data = storage.exportData();
  data.currentUserId = userId;
  storage.importData(data);
}

/**
 * Reset all data and reinitialize demo
 */
export function resetDemo(): void {
  storage.clearAll();
  initializeDemoMarkets();
}

// ============================================================
// Auto-initialize on import
// ============================================================

// Check if we should auto-initialize
if (typeof window !== 'undefined') {
  // Initialize on next tick to allow storage to load first
  setTimeout(() => {
    initializeDemoMarkets();
  }, 0);
}
