/**
 * Matching Engine - CLOB (Central Limit Order Book) Implementation
 *
 * Features:
 * - Price-time priority matching
 * - Partial fill support
 * - Self-trade prevention
 * - Atomic position and balance updates
 */

import type {
  Order,
  Trade,
  Position,
  User,
  Market,
  MatchResult,
  PlaceOrderResult,
  CancelOrderResult,
} from './types';
import { storage } from './storage';
import {
  generateTradeId,
  roundPrice,
  isValidPrice,
  createOrder,
  isMarketTradeable,
} from './helpers';

// ============================================================
// Matching Engine
// ============================================================

/**
 * Place a new order and attempt to match it
 */
export function placeOrder(params: {
  marketId: string;
  outcomeId: string;
  side: Order['side'];
  price: number;
  quantity: number;
}): PlaceOrderResult {
  const { marketId, outcomeId, side, price, quantity } = params;

  // Validate price
  if (!isValidPrice(price)) {
    return { success: false, error: 'Price must be between 0.01 and 0.99' };
  }

  // Validate quantity
  if (quantity <= 0 || !Number.isFinite(quantity)) {
    return { success: false, error: 'Quantity must be a positive number' };
  }

  // Get market
  const market = storage.getMarket(marketId);
  if (!market) {
    return { success: false, error: 'Market not found' };
  }

  // Check if market is tradeable
  if (!isMarketTradeable(market)) {
    return { success: false, error: 'Market is not open for trading' };
  }

  // Validate outcome exists
  const outcome = market.outcomes.find((o) => o.id === outcomeId);
  if (!outcome) {
    return { success: false, error: 'Outcome not found' };
  }

  // Get current user
  const user = storage.getCurrentUser();

  // Validate balance/position for order
  if (side === 'BUY') {
    const requiredCash = roundPrice(price * quantity);
    if (requiredCash > user.cashBalance) {
      return { success: false, error: `Insufficient balance. Need $${requiredCash.toFixed(2)}, have $${user.cashBalance.toFixed(2)}` };
    }
  } else {
    // SELL - check position
    const position = storage.getPosition(user.id, marketId, outcomeId);
    const availableShares = position?.shares || 0;
    if (quantity > availableShares) {
      return { success: false, error: `Insufficient shares. Have ${availableShares}, trying to sell ${quantity}` };
    }
  }

  // Create the order
  const order = createOrder({
    marketId,
    outcomeId,
    userId: user.id,
    side,
    price: roundPrice(price),
    quantity,
  });

  // Lock funds/shares
  if (side === 'BUY') {
    user.cashBalance -= roundPrice(price * quantity);
    user.lockedCash += roundPrice(price * quantity);
  }
  // For SELL, we don't lock shares separately - they're already in position

  // Attempt to match
  const matchResult = matchOrder(order, market, user);

  // Update market volume
  let volumeIncrease = 0;
  for (const trade of matchResult.trades) {
    volumeIncrease += trade.total;
  }
  if (volumeIncrease > 0) {
    market.totalVolume += volumeIncrease;
    const outcomeToUpdate = market.outcomes.find((o) => o.id === outcomeId);
    if (outcomeToUpdate) {
      outcomeToUpdate.volume += volumeIncrease;
      // Update price from last trade
      const lastTrade = matchResult.trades[matchResult.trades.length - 1];
      if (lastTrade) {
        outcomeToUpdate.price = lastTrade.price;
      }
    }
    storage.updateMarket(market);
  }

  // Apply all changes atomically
  storage.applyChanges({
    orders: [matchResult.takerOrder, ...matchResult.updatedMakerOrders],
    trades: matchResult.trades,
    positions: matchResult.positionChanges.map((pc) => {
      const existing = storage.getPosition(pc.userId, pc.marketId, pc.outcomeId);
      const newShares = (existing?.shares || 0) + pc.sharesDelta;
      const newTotalCost = (existing?.totalCost || 0) + pc.costDelta;
      const newAvgCost = newShares > 0 ? newTotalCost / newShares : 0;

      return {
        userId: pc.userId,
        marketId: pc.marketId,
        outcomeId: pc.outcomeId,
        shares: Math.max(0, newShares),
        avgCost: roundPrice(newAvgCost),
        totalCost: Math.max(0, newTotalCost),
        updatedAt: Date.now(),
      };
    }),
    user,
  });

  return {
    success: true,
    order: matchResult.takerOrder,
    trades: matchResult.trades,
  };
}

/**
 * Match an incoming order against the order book
 */
function matchOrder(takerOrder: Order, market: Market, takerUser: User): MatchResult {
  const trades: Trade[] = [];
  const updatedMakerOrders: Order[] = [];
  const positionChanges: Map<string, { sharesDelta: number; costDelta: number }> = new Map();

  // Get opposing orders
  const opposingSide = takerOrder.side === 'BUY' ? 'SELL' : 'BUY';
  let opposingOrders = storage.getOpenOrders(takerOrder.marketId, takerOrder.outcomeId)
    .filter((o) => o.side === opposingSide && o.userId !== takerOrder.userId); // Self-trade prevention

  // Sort by price-time priority
  if (takerOrder.side === 'BUY') {
    // For buy orders, match with lowest asks first
    opposingOrders.sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);
  } else {
    // For sell orders, match with highest bids first
    opposingOrders.sort((a, b) => b.price - a.price || a.createdAt - b.createdAt);
  }

  let remainingQty = takerOrder.remaining;

  for (const makerOrder of opposingOrders) {
    if (remainingQty <= 0) break;

    // Check price compatibility
    const priceMatch = takerOrder.side === 'BUY'
      ? makerOrder.price <= takerOrder.price  // Buy at or below taker's price
      : makerOrder.price >= takerOrder.price; // Sell at or above taker's price

    if (!priceMatch) break; // No more matches possible (orders are sorted)

    // Calculate fill quantity
    const fillQty = Math.min(remainingQty, makerOrder.remaining);
    const fillPrice = makerOrder.price; // Execute at maker's price

    // Create trade
    const trade: Trade = {
      id: generateTradeId(),
      marketId: takerOrder.marketId,
      outcomeId: takerOrder.outcomeId,
      makerOrderId: makerOrder.id,
      makerId: makerOrder.userId,
      takerOrderId: takerOrder.id,
      takerId: takerOrder.userId,
      price: fillPrice,
      quantity: fillQty,
      total: roundPrice(fillPrice * fillQty),
      takerSide: takerOrder.side,
      createdAt: Date.now(),
    };
    trades.push(trade);

    // Update maker order
    makerOrder.remaining -= fillQty;
    makerOrder.status = makerOrder.remaining === 0 ? 'FILLED' : 'PARTIAL';
    if (makerOrder.remaining === 0) {
      makerOrder.filledAt = Date.now();
    }
    makerOrder.updatedAt = Date.now();
    updatedMakerOrders.push(makerOrder);

    // Update remaining quantity
    remainingQty -= fillQty;

    // Calculate position changes
    const tradeValue = roundPrice(fillPrice * fillQty);

    if (takerOrder.side === 'BUY') {
      // Taker buys shares from maker
      // Taker: +shares, cash already locked, unlock excess
      const takerKey = `${takerOrder.userId}:${takerOrder.marketId}:${takerOrder.outcomeId}`;
      const takerChange = positionChanges.get(takerKey) || { sharesDelta: 0, costDelta: 0 };
      takerChange.sharesDelta += fillQty;
      takerChange.costDelta += tradeValue;
      positionChanges.set(takerKey, takerChange);

      // Unlock the cash that was locked for this order (at taker price) and deduct actual cost (at maker price)
      const lockedForThis = roundPrice(takerOrder.price * fillQty);
      const actualCost = tradeValue;
      takerUser.lockedCash -= lockedForThis;
      takerUser.cashBalance += (lockedForThis - actualCost); // Return the difference

      // Maker: -shares, +cash
      const makerKey = `${makerOrder.userId}:${makerOrder.marketId}:${makerOrder.outcomeId}`;
      const makerChange = positionChanges.get(makerKey) || { sharesDelta: 0, costDelta: 0 };
      makerChange.sharesDelta -= fillQty;
      // Reduce cost basis proportionally
      const makerPosition = storage.getPosition(makerOrder.userId, takerOrder.marketId, takerOrder.outcomeId);
      if (makerPosition && makerPosition.shares > 0) {
        const costReduction = (makerPosition.totalCost / makerPosition.shares) * fillQty;
        makerChange.costDelta -= costReduction;
      }
      positionChanges.set(makerKey, makerChange);

      // Credit maker's cash
      const makerUser = storage.exportData().users.find((u) => u.id === makerOrder.userId);
      if (makerUser) {
        makerUser.cashBalance += tradeValue;
        makerUser.updatedAt = Date.now();
        storage.updateUser(makerUser);
      }
    } else {
      // Taker sells shares to maker
      // Taker: -shares, +cash
      const takerKey = `${takerOrder.userId}:${takerOrder.marketId}:${takerOrder.outcomeId}`;
      const takerChange = positionChanges.get(takerKey) || { sharesDelta: 0, costDelta: 0 };
      takerChange.sharesDelta -= fillQty;
      // Reduce cost basis proportionally
      const takerPosition = storage.getPosition(takerOrder.userId, takerOrder.marketId, takerOrder.outcomeId);
      if (takerPosition && takerPosition.shares > 0) {
        const costReduction = (takerPosition.totalCost / takerPosition.shares) * fillQty;
        takerChange.costDelta -= costReduction;
      }
      positionChanges.set(takerKey, takerChange);
      takerUser.cashBalance += tradeValue;

      // Maker: +shares, cash was locked, now gets shares
      const makerKey = `${makerOrder.userId}:${makerOrder.marketId}:${makerOrder.outcomeId}`;
      const makerChange = positionChanges.get(makerKey) || { sharesDelta: 0, costDelta: 0 };
      makerChange.sharesDelta += fillQty;
      makerChange.costDelta += tradeValue;
      positionChanges.set(makerKey, makerChange);

      // Unlock maker's cash
      const makerUser = storage.exportData().users.find((u) => u.id === makerOrder.userId);
      if (makerUser) {
        const makerLockedForThis = roundPrice(makerOrder.price * fillQty);
        makerUser.lockedCash -= makerLockedForThis;
        // Return difference if maker got a better price
        makerUser.cashBalance += (makerLockedForThis - tradeValue);
        makerUser.updatedAt = Date.now();
        storage.updateUser(makerUser);
      }
    }
  }

  // Update taker order status
  takerOrder.remaining = remainingQty;
  if (remainingQty === 0) {
    takerOrder.status = 'FILLED';
    takerOrder.filledAt = Date.now();
  } else if (remainingQty < takerOrder.quantity) {
    takerOrder.status = 'PARTIAL';
  }
  takerOrder.updatedAt = Date.now();

  // Convert position changes map to array
  const positionChangeArray = Array.from(positionChanges.entries()).map(([key, change]) => {
    const [userId, marketId, outcomeId] = key.split(':');
    return {
      userId,
      marketId,
      outcomeId,
      sharesDelta: change.sharesDelta,
      costDelta: change.costDelta,
    };
  });

  return {
    trades,
    updatedMakerOrders,
    takerOrder,
    positionChanges: positionChangeArray,
    balanceChanges: [], // Balance changes are handled inline
  };
}

/**
 * Cancel an open order
 */
export function cancelOrder(orderId: string): CancelOrderResult {
  const order = storage.getOrder(orderId);
  if (!order) {
    return { success: false, error: 'Order not found' };
  }

  const user = storage.getCurrentUser();
  if (order.userId !== user.id) {
    return { success: false, error: 'Not authorized to cancel this order' };
  }

  if (order.status === 'FILLED' || order.status === 'CANCELED') {
    return { success: false, error: 'Order is already filled or canceled' };
  }

  // Refund locked funds
  if (order.side === 'BUY') {
    const lockedAmount = roundPrice(order.price * order.remaining);
    user.lockedCash -= lockedAmount;
    user.cashBalance += lockedAmount;
  }
  // For SELL orders, shares were never actually locked (just validated)

  // Update order status
  order.status = 'CANCELED';
  order.updatedAt = Date.now();

  storage.updateOrder(order);
  storage.updateUser(user);

  return { success: true };
}

/**
 * Cancel all open orders for a market (used during resolution)
 */
export function cancelAllOrdersForMarket(marketId: string): void {
  const orders = storage.getOrders({ marketId }).filter(
    (o) => o.status === 'OPEN' || o.status === 'PARTIAL'
  );

  for (const order of orders) {
    if (order.side === 'BUY' && order.remaining > 0) {
      const user = storage.exportData().users.find((u) => u.id === order.userId);
      if (user) {
        const lockedAmount = roundPrice(order.price * order.remaining);
        user.lockedCash -= lockedAmount;
        user.cashBalance += lockedAmount;
        user.updatedAt = Date.now();
        storage.updateUser(user);
      }
    }

    order.status = 'CANCELED';
    order.updatedAt = Date.now();
  }

  storage.updateOrders(orders);
}

// ============================================================
// Order Book Queries
// ============================================================

export interface OrderBookSummary {
  bids: { price: number; quantity: number; orders: number }[];
  asks: { price: number; quantity: number; orders: number }[];
  bestBid?: number;
  bestAsk?: number;
  midPrice?: number;
  spread?: number;
  lastTradePrice?: number;
}

/**
 * Get order book summary for an outcome
 */
export function getOrderBookSummary(marketId: string, outcomeId: string): OrderBookSummary {
  const orders = storage.getOpenOrders(marketId, outcomeId);

  // Group bids
  const bidMap = new Map<number, { quantity: number; orders: number }>();
  const askMap = new Map<number, { quantity: number; orders: number }>();

  for (const order of orders) {
    if (order.remaining <= 0) continue;

    const map = order.side === 'BUY' ? bidMap : askMap;
    const existing = map.get(order.price) || { quantity: 0, orders: 0 };
    existing.quantity += order.remaining;
    existing.orders += 1;
    map.set(order.price, existing);
  }

  // Convert to sorted arrays
  const bids = Array.from(bidMap.entries())
    .map(([price, data]) => ({ price, ...data }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 10);

  const asks = Array.from(askMap.entries())
    .map(([price, data]) => ({ price, ...data }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);

  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  const midPrice = bestBid !== undefined && bestAsk !== undefined
    ? roundPrice((bestBid + bestAsk) / 2)
    : undefined;
  const spread = bestBid !== undefined && bestAsk !== undefined
    ? roundPrice(bestAsk - bestBid)
    : undefined;

  const lastTradePrice = storage.getLastTradePrice(marketId, outcomeId);

  return {
    bids,
    asks,
    bestBid,
    bestAsk,
    midPrice,
    spread,
    lastTradePrice,
  };
}

/**
 * Get display price for an outcome
 * Prefers mid price, falls back to last trade, then 0.50
 */
export function getDisplayPrice(marketId: string, outcomeId: string): number {
  const book = getOrderBookSummary(marketId, outcomeId);

  if (book.midPrice !== undefined && book.spread !== undefined && book.spread <= 0.10) {
    return book.midPrice;
  }

  if (book.lastTradePrice !== undefined) {
    return book.lastTradePrice;
  }

  // Check market initial price
  const market = storage.getMarket(marketId);
  const outcome = market?.outcomes.find((o) => o.id === outcomeId);
  if (outcome?.price) {
    return outcome.price;
  }

  return 0.50;
}
