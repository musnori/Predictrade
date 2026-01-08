/**
 * Matching Engine Unit Tests
 *
 * Test cases:
 * 1. Fully fill - complete order match
 * 2. Partial fill - order partially matched
 * 3. Price-time priority - orders matched in correct order
 * 4. Multiple matches - one order matches multiple opposing orders
 * 5. Self-trade prevention - user's own orders don't match
 */

import { storage } from './storage';
import { placeOrder, cancelOrder, getOrderBookSummary } from './matchingEngine';
import { createMarket, createUser, generateUserId } from './helpers';
import type { Market, User } from './types';

// ============================================================
// Test Utilities
// ============================================================

function setupTestEnvironment(): { market: Market; user1: User; user2: User } {
  // Clear storage
  storage.clearAll();

  // Create test market
  const market = createMarket({
    question: 'Test Market',
    description: 'A test market',
    type: 'BINARY',
    outcomes: [{ label: 'Yes' }, { label: 'No' }],
    endTime: Date.now() + 24 * 60 * 60 * 1000, // 24 hours from now
    category: 'test',
    resolutionSource: 'Admin',
    resolutionRules: 'Admin decides',
  });
  storage.addMarket(market);

  // Create test users
  const user1 = createUser('User1');
  user1.cashBalance = 10000;
  storage.updateUser(user1);

  const user2 = createUser('User2');
  user2.cashBalance = 10000;
  storage.updateUser(user2);

  // Set user1 as current user
  const data = storage.exportData();
  data.currentUserId = user1.id;
  storage.importData(data);

  return { market, user1, user2 };
}

function switchUser(userId: string): void {
  const data = storage.exportData();
  data.currentUserId = userId;
  storage.importData(data);
}

// ============================================================
// Test Cases
// ============================================================

/**
 * Test 1: Fully Fill
 * When a buy order exactly matches a sell order, both should be fully filled
 */
function testFullyFill(): boolean {
  console.log('\n--- Test 1: Fully Fill ---');

  const { market, user1, user2 } = setupTestEnvironment();
  const outcomeId = market.outcomes[0].id;

  // Give user2 some shares to sell
  const position = {
    userId: user2.id,
    marketId: market.id,
    outcomeId,
    shares: 100,
    avgCost: 0.50,
    totalCost: 50,
    updatedAt: Date.now(),
  };
  storage.updatePosition(position);

  // User2 places a sell order at 0.60
  switchUser(user2.id);
  const sellResult = placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'SELL',
    price: 0.60,
    quantity: 50,
  });

  if (!sellResult.success) {
    console.log('FAIL: Sell order failed:', sellResult.error);
    return false;
  }

  // User1 places a buy order at 0.60 for same quantity
  switchUser(user1.id);
  const buyResult = placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'BUY',
    price: 0.60,
    quantity: 50,
  });

  if (!buyResult.success) {
    console.log('FAIL: Buy order failed:', buyResult.error);
    return false;
  }

  // Check results
  if (buyResult.order?.status !== 'FILLED') {
    console.log('FAIL: Buy order not fully filled, status:', buyResult.order?.status);
    return false;
  }

  if (buyResult.trades?.length !== 1) {
    console.log('FAIL: Expected 1 trade, got:', buyResult.trades?.length);
    return false;
  }

  if (buyResult.trades?.[0].quantity !== 50) {
    console.log('FAIL: Trade quantity mismatch:', buyResult.trades?.[0].quantity);
    return false;
  }

  console.log('PASS: Full fill works correctly');
  return true;
}

/**
 * Test 2: Partial Fill
 * When a buy order is larger than available sell orders, it should be partially filled
 */
function testPartialFill(): boolean {
  console.log('\n--- Test 2: Partial Fill ---');

  const { market, user1, user2 } = setupTestEnvironment();
  const outcomeId = market.outcomes[0].id;

  // Give user2 some shares to sell
  const position = {
    userId: user2.id,
    marketId: market.id,
    outcomeId,
    shares: 30,
    avgCost: 0.50,
    totalCost: 15,
    updatedAt: Date.now(),
  };
  storage.updatePosition(position);

  // User2 places a sell order at 0.50 for 30 shares
  switchUser(user2.id);
  const sellResult = placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'SELL',
    price: 0.50,
    quantity: 30,
  });

  if (!sellResult.success) {
    console.log('FAIL: Sell order failed:', sellResult.error);
    return false;
  }

  // User1 places a buy order at 0.55 for 100 shares (more than available)
  switchUser(user1.id);
  const buyResult = placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'BUY',
    price: 0.55,
    quantity: 100,
  });

  if (!buyResult.success) {
    console.log('FAIL: Buy order failed:', buyResult.error);
    return false;
  }

  // Check results - should be partially filled
  if (buyResult.order?.status !== 'PARTIAL') {
    console.log('FAIL: Order should be PARTIAL, got:', buyResult.order?.status);
    return false;
  }

  if (buyResult.order?.remaining !== 70) {
    console.log('FAIL: Remaining should be 70, got:', buyResult.order?.remaining);
    return false;
  }

  if (buyResult.trades?.length !== 1) {
    console.log('FAIL: Expected 1 trade, got:', buyResult.trades?.length);
    return false;
  }

  if (buyResult.trades?.[0].quantity !== 30) {
    console.log('FAIL: Trade quantity should be 30, got:', buyResult.trades?.[0].quantity);
    return false;
  }

  console.log('PASS: Partial fill works correctly');
  return true;
}

/**
 * Test 3: Price-Time Priority
 * Orders should be matched in price-time priority order
 */
function testPriceTimePriority(): boolean {
  console.log('\n--- Test 3: Price-Time Priority ---');

  const { market, user1, user2 } = setupTestEnvironment();
  const outcomeId = market.outcomes[0].id;

  // Create a third user
  const user3 = createUser('User3');
  user3.cashBalance = 10000;
  storage.updateUser(user3);

  // Give both users shares to sell
  storage.updatePosition({
    userId: user2.id,
    marketId: market.id,
    outcomeId,
    shares: 100,
    avgCost: 0.40,
    totalCost: 40,
    updatedAt: Date.now(),
  });

  storage.updatePosition({
    userId: user3.id,
    marketId: market.id,
    outcomeId,
    shares: 100,
    avgCost: 0.40,
    totalCost: 40,
    updatedAt: Date.now(),
  });

  // User2 places sell at 0.55
  switchUser(user2.id);
  placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'SELL',
    price: 0.55,
    quantity: 50,
  });

  // User3 places sell at 0.50 (better price)
  switchUser(user3.id);
  placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'SELL',
    price: 0.50,
    quantity: 50,
  });

  // User1 buys at 0.60 - should match User3's 0.50 first (better price)
  switchUser(user1.id);
  const buyResult = placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'BUY',
    price: 0.60,
    quantity: 30,
  });

  if (!buyResult.success) {
    console.log('FAIL: Buy order failed:', buyResult.error);
    return false;
  }

  // Should match at maker's price (0.50)
  if (buyResult.trades?.[0].price !== 0.50) {
    console.log('FAIL: Should match at 0.50, got:', buyResult.trades?.[0].price);
    return false;
  }

  // Trade should be with user3
  if (buyResult.trades?.[0].makerId !== user3.id) {
    console.log('FAIL: Should match with User3 first');
    return false;
  }

  console.log('PASS: Price-time priority works correctly');
  return true;
}

/**
 * Test 4: Multiple Matches
 * One order can match multiple opposing orders
 */
function testMultipleMatches(): boolean {
  console.log('\n--- Test 4: Multiple Matches ---');

  const { market, user1, user2 } = setupTestEnvironment();
  const outcomeId = market.outcomes[0].id;

  // Create users 3 and 4
  const user3 = createUser('User3');
  user3.cashBalance = 10000;
  storage.updateUser(user3);

  const user4 = createUser('User4');
  user4.cashBalance = 10000;
  storage.updateUser(user4);

  // Give all users shares
  for (const user of [user2, user3, user4]) {
    storage.updatePosition({
      userId: user.id,
      marketId: market.id,
      outcomeId,
      shares: 100,
      avgCost: 0.40,
      totalCost: 40,
      updatedAt: Date.now(),
    });
  }

  // Each user places a small sell order
  switchUser(user2.id);
  placeOrder({ marketId: market.id, outcomeId, side: 'SELL', price: 0.50, quantity: 20 });

  switchUser(user3.id);
  placeOrder({ marketId: market.id, outcomeId, side: 'SELL', price: 0.50, quantity: 30 });

  switchUser(user4.id);
  placeOrder({ marketId: market.id, outcomeId, side: 'SELL', price: 0.50, quantity: 25 });

  // User1 places a large buy order that matches all three
  switchUser(user1.id);
  const buyResult = placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'BUY',
    price: 0.50,
    quantity: 75, // Exactly matches all three orders
  });

  if (!buyResult.success) {
    console.log('FAIL: Buy order failed:', buyResult.error);
    return false;
  }

  if (buyResult.trades?.length !== 3) {
    console.log('FAIL: Expected 3 trades, got:', buyResult.trades?.length);
    return false;
  }

  const totalQuantity = buyResult.trades?.reduce((sum, t) => sum + t.quantity, 0) || 0;
  if (totalQuantity !== 75) {
    console.log('FAIL: Total quantity should be 75, got:', totalQuantity);
    return false;
  }

  if (buyResult.order?.status !== 'FILLED') {
    console.log('FAIL: Order should be FILLED, got:', buyResult.order?.status);
    return false;
  }

  console.log('PASS: Multiple matches work correctly');
  return true;
}

/**
 * Test 5: Self-Trade Prevention
 * User's own orders should not match against each other
 */
function testSelfTradePrevention(): boolean {
  console.log('\n--- Test 5: Self-Trade Prevention ---');

  const { market, user1 } = setupTestEnvironment();
  const outcomeId = market.outcomes[0].id;

  // Give user1 some shares
  storage.updatePosition({
    userId: user1.id,
    marketId: market.id,
    outcomeId,
    shares: 100,
    avgCost: 0.50,
    totalCost: 50,
    updatedAt: Date.now(),
  });

  // User1 places a sell order
  switchUser(user1.id);
  const sellResult = placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'SELL',
    price: 0.50,
    quantity: 50,
  });

  if (!sellResult.success) {
    console.log('FAIL: Sell order failed:', sellResult.error);
    return false;
  }

  // User1 places a buy order at same price - should NOT match
  const buyResult = placeOrder({
    marketId: market.id,
    outcomeId,
    side: 'BUY',
    price: 0.50,
    quantity: 30,
  });

  if (!buyResult.success) {
    console.log('FAIL: Buy order failed:', buyResult.error);
    return false;
  }

  // Should have no trades (self-trade prevented)
  if (buyResult.trades && buyResult.trades.length > 0) {
    console.log('FAIL: Self-trade occurred! Trades:', buyResult.trades.length);
    return false;
  }

  // Order should be OPEN (not matched)
  if (buyResult.order?.status !== 'OPEN') {
    console.log('FAIL: Order should be OPEN, got:', buyResult.order?.status);
    return false;
  }

  // Both orders should be in the book
  const book = getOrderBookSummary(market.id, outcomeId);
  if (book.bids.length === 0 || book.asks.length === 0) {
    console.log('FAIL: Both orders should be in the book');
    return false;
  }

  console.log('PASS: Self-trade prevention works correctly');
  return true;
}

// ============================================================
// Test Runner
// ============================================================

export function runAllTests(): { passed: number; failed: number; results: string[] } {
  const tests = [
    { name: 'Fully Fill', fn: testFullyFill },
    { name: 'Partial Fill', fn: testPartialFill },
    { name: 'Price-Time Priority', fn: testPriceTimePriority },
    { name: 'Multiple Matches', fn: testMultipleMatches },
    { name: 'Self-Trade Prevention', fn: testSelfTradePrevention },
  ];

  let passed = 0;
  let failed = 0;
  const results: string[] = [];

  console.log('======================================');
  console.log('Running Matching Engine Tests');
  console.log('======================================');

  for (const test of tests) {
    try {
      const success = test.fn();
      if (success) {
        passed++;
        results.push(`✓ ${test.name}`);
      } else {
        failed++;
        results.push(`✗ ${test.name}`);
      }
    } catch (error) {
      failed++;
      results.push(`✗ ${test.name} (Error: ${error})`);
      console.error(`Error in ${test.name}:`, error);
    }
  }

  console.log('\n======================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('======================================');

  return { passed, failed, results };
}

// Auto-run if executed directly (for browser console)
if (typeof window !== 'undefined') {
  (window as any).runMatchingEngineTests = runAllTests;
}
