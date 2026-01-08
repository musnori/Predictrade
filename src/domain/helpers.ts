/**
 * Domain Helper Functions
 */

import type { Market, Outcome, Order, Trade, Position, User, OrderBook, OrderBookLevel } from './types';

// ============================================================
// ID Generation
// ============================================================

export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

export const generateMarketId = () => generateId('mkt');
export const generateOutcomeId = () => generateId('out');
export const generateOrderId = () => generateId('ord');
export const generateTradeId = () => generateId('trd');
export const generateUserId = () => generateId('usr');

// ============================================================
// Price Utilities
// ============================================================

/** Round price to 2 decimal places (0.01 - 0.99) */
export function roundPrice(price: number): number {
  return Math.round(price * 100) / 100;
}

/** Validate price is within range */
export function isValidPrice(price: number): boolean {
  return price >= 0.01 && price <= 0.99;
}

/** Format price as cents (e.g., 0.63 -> "63¢") */
export function formatPriceCents(price: number): string {
  return `${Math.round(price * 100)}¢`;
}

/** Format price as percentage (e.g., 0.63 -> "63%") */
export function formatPricePercent(price: number): string {
  return `${Math.round(price * 100)}%`;
}

/** Format USD amount (e.g., 1234.56 -> "$1,234.56") */
export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/** Format number with commas */
export function formatNumber(num: number, decimals: number = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

// ============================================================
// Time Utilities
// ============================================================

/** Get remaining time until timestamp */
export function getTimeRemaining(endTime: number): {
  days: number;
  hours: number;
  minutes: number;
  total: number;
  expired: boolean;
} {
  const total = endTime - Date.now();
  const expired = total <= 0;

  if (expired) {
    return { days: 0, hours: 0, minutes: 0, total: 0, expired: true };
  }

  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  const hours = Math.floor((total % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((total % (1000 * 60 * 60)) / (1000 * 60));

  return { days, hours, minutes, total, expired };
}

/** Format remaining time as string */
export function formatTimeRemaining(endTime: number): string {
  const { days, hours, minutes, expired } = getTimeRemaining(endTime);

  if (expired) {
    return 'Ended';
  }

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/** Format timestamp as date string */
export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

// ============================================================
// Market Utilities
// ============================================================

/** Check if market is tradeable */
export function isMarketTradeable(market: Market): boolean {
  return market.status === 'OPEN' && Date.now() < market.endTime;
}

/** Get display price for an outcome (mid price or last trade) */
export function getOutcomeDisplayPrice(orderBook: OrderBook): number {
  // Prefer mid price if bid/ask exist
  if (orderBook.midPrice !== undefined) {
    return orderBook.midPrice;
  }
  // Fall back to last trade price
  if (orderBook.lastTradePrice !== undefined) {
    return orderBook.lastTradePrice;
  }
  // Default to 0.50 (50%)
  return 0.50;
}

/** Sort outcomes by price (highest first) */
export function sortOutcomesByPrice(outcomes: Outcome[]): Outcome[] {
  return [...outcomes].sort((a, b) => b.price - a.price);
}

// ============================================================
// OrderBook Utilities
// ============================================================

/** Build order book from orders */
export function buildOrderBook(
  orders: Order[],
  outcomeId: string,
  lastTradePrice?: number
): OrderBook {
  const outcomeOrders = orders.filter(
    (o) => o.outcomeId === outcomeId && o.status !== 'FILLED' && o.status !== 'CANCELED'
  );

  // Group by price and side
  const bidMap = new Map<number, { quantity: number; orderCount: number }>();
  const askMap = new Map<number, { quantity: number; orderCount: number }>();

  for (const order of outcomeOrders) {
    if (order.remaining <= 0) continue;

    const map = order.side === 'BUY' ? bidMap : askMap;
    const existing = map.get(order.price) || { quantity: 0, orderCount: 0 };
    existing.quantity += order.remaining;
    existing.orderCount += 1;
    map.set(order.price, existing);
  }

  // Convert to arrays
  const bids: OrderBookLevel[] = Array.from(bidMap.entries())
    .map(([price, data]) => ({ price, ...data }))
    .sort((a, b) => b.price - a.price);

  const asks: OrderBookLevel[] = Array.from(askMap.entries())
    .map(([price, data]) => ({ price, ...data }))
    .sort((a, b) => a.price - b.price);

  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;

  let midPrice: number | undefined;
  let spread: number | undefined;

  if (bestBid !== undefined && bestAsk !== undefined) {
    midPrice = roundPrice((bestBid + bestAsk) / 2);
    spread = roundPrice(bestAsk - bestBid);
  }

  return {
    outcomeId,
    bids,
    asks,
    bestBid,
    bestAsk,
    midPrice,
    spread,
    lastTradePrice,
  };
}

// ============================================================
// Position Utilities
// ============================================================

/** Calculate unrealized P&L for a position */
export function calculateUnrealizedPnl(position: Position, currentPrice: number): number {
  if (position.shares === 0) return 0;
  const currentValue = position.shares * currentPrice;
  return currentValue - position.totalCost;
}

/** Calculate position value at resolution */
export function calculateResolutionValue(position: Position, isWinner: boolean): number {
  return isWinner ? position.shares : 0;
}

// ============================================================
// User Utilities
// ============================================================

/** Calculate total equity (cash + positions value) */
export function calculateTotalEquity(
  user: User,
  positions: Position[],
  getCurrentPrice: (marketId: string, outcomeId: string) => number
): number {
  let total = user.cashBalance;

  for (const position of positions) {
    if (position.userId === user.id && position.shares > 0) {
      const price = getCurrentPrice(position.marketId, position.outcomeId);
      total += position.shares * price;
    }
  }

  return total;
}

// ============================================================
// Validation Utilities
// ============================================================

export interface ValidationError {
  field: string;
  message: string;
}

export function validateOrder(
  order: Partial<Order>,
  user: User,
  market: Market,
  userPosition?: Position
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!order.price || !isValidPrice(order.price)) {
    errors.push({ field: 'price', message: 'Price must be between 0.01 and 0.99' });
  }

  if (!order.quantity || order.quantity <= 0) {
    errors.push({ field: 'quantity', message: 'Quantity must be greater than 0' });
  }

  if (!isMarketTradeable(market)) {
    errors.push({ field: 'market', message: 'Market is not open for trading' });
  }

  if (order.side === 'BUY' && order.price && order.quantity) {
    const requiredCash = order.price * order.quantity;
    if (requiredCash > user.cashBalance) {
      errors.push({ field: 'quantity', message: 'Insufficient cash balance' });
    }
  }

  if (order.side === 'SELL' && order.quantity) {
    const availableShares = userPosition?.shares || 0;
    if (order.quantity > availableShares) {
      errors.push({ field: 'quantity', message: 'Insufficient shares to sell' });
    }
  }

  return errors;
}

// ============================================================
// Factory Functions
// ============================================================

export function createUser(displayName: string = 'Anonymous'): User {
  const now = Date.now();
  return {
    id: generateUserId(),
    displayName,
    cashBalance: 1000.00,  // Initial demo balance
    lockedCash: 0,
    realizedPnl: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function createMarket(params: {
  question: string;
  description: string;
  type: Market['type'];
  outcomes: { label: string }[];
  endTime: number;
  category: string;
  resolutionSource: string;
  resolutionRules: string;
}): Market {
  const now = Date.now();
  const marketId = generateMarketId();

  // Initialize outcomes with 50% price for binary, equal distribution for multi
  const initialPrice = params.type === 'BINARY' ? 0.50 : roundPrice(1 / params.outcomes.length);

  const outcomes: Outcome[] = params.outcomes.map((o) => ({
    id: generateOutcomeId(),
    label: o.label,
    price: initialPrice,
    volume: 0,
  }));

  return {
    id: marketId,
    question: params.question,
    description: params.description,
    type: params.type,
    status: 'OPEN',
    resolutionSource: params.resolutionSource,
    resolutionRules: params.resolutionRules,
    endTime: params.endTime,
    outcomes,
    category: params.category,
    totalVolume: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function createOrder(params: {
  marketId: string;
  outcomeId: string;
  userId: string;
  side: Order['side'];
  price: number;
  quantity: number;
}): Order {
  const now = Date.now();
  return {
    id: generateOrderId(),
    marketId: params.marketId,
    outcomeId: params.outcomeId,
    userId: params.userId,
    side: params.side,
    price: roundPrice(params.price),
    quantity: params.quantity,
    remaining: params.quantity,
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
  };
}
