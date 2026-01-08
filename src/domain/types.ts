/**
 * Predictrade Domain Types - Polymarket Style
 *
 * Core concepts:
 * - Market: An event/question with multiple outcomes
 * - Outcome: A possible result (Yes/No or multiple candidates)
 * - Price = Probability (0.01-0.99 = 1%-99%)
 * - Shares: Units that pay $1 if correct, $0 if incorrect
 */

// ============================================================
// Market Types
// ============================================================

export type MarketType = 'BINARY' | 'MULTI_OUTCOME';
export type MarketStatus = 'OPEN' | 'CLOSED' | 'RESOLUTION_PROPOSED' | 'DISPUTED' | 'RESOLVED';

export interface Outcome {
  id: string;
  label: string;           // "Yes", "No", "Trump", "Biden", etc.
  /** Current price (0.01-0.99), derived from orderbook */
  price: number;
  /** Total volume traded (in USD) */
  volume: number;
}

export interface Market {
  id: string;
  question: string;
  description: string;
  type: MarketType;
  status: MarketStatus;

  /** Resolution source (e.g., "Associated Press", "Admin decision") */
  resolutionSource: string;
  /** Resolution rules/criteria */
  resolutionRules: string;

  /** Market end time (trading stops) */
  endTime: number;  // Unix timestamp

  /** All possible outcomes */
  outcomes: Outcome[];

  /** Category for filtering */
  category: string;

  /** Total volume across all outcomes */
  totalVolume: number;

  /** Resolution proposal data (if status is RESOLUTION_PROPOSED or DISPUTED) */
  resolutionProposal?: ResolutionProposal;

  /** Final resolved outcome ID (if status is RESOLVED) */
  resolvedOutcomeId?: string;
  resolvedAt?: number;

  createdAt: number;
  updatedAt: number;
}

export interface ResolutionProposal {
  proposedOutcomeId: string;
  proposedAt: number;
  proposedBy: string;
  challengePeriodEndsAt: number;
  disputedAt?: number;
  disputedBy?: string;
  disputeReason?: string;
}

// ============================================================
// Order Types
// ============================================================

export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELED';

export interface Order {
  id: string;
  marketId: string;
  outcomeId: string;
  userId: string;

  side: OrderSide;
  /** Price per share (0.01-0.99) */
  price: number;
  /** Total quantity ordered */
  quantity: number;
  /** Remaining unfilled quantity */
  remaining: number;

  status: OrderStatus;

  createdAt: number;
  updatedAt: number;
  filledAt?: number;
}

// ============================================================
// Trade Types
// ============================================================

export interface Trade {
  id: string;
  marketId: string;
  outcomeId: string;

  /** Maker order ID */
  makerOrderId: string;
  makerId: string;
  /** Taker order ID */
  takerOrderId: string;
  takerId: string;

  /** Execution price (maker's price) */
  price: number;
  /** Quantity executed */
  quantity: number;

  /** Total value (price * quantity) */
  total: number;

  /** Which side was the taker */
  takerSide: OrderSide;

  createdAt: number;
}

// ============================================================
// Position Types
// ============================================================

export interface Position {
  marketId: string;
  outcomeId: string;
  userId: string;

  /** Number of shares held */
  shares: number;
  /** Average cost per share */
  avgCost: number;
  /** Total cost basis */
  totalCost: number;

  updatedAt: number;
}

// ============================================================
// User Types
// ============================================================

export interface User {
  id: string;
  displayName: string;

  /** Available cash balance (pseudo USDC) */
  cashBalance: number;
  /** Cash locked in pending orders */
  lockedCash: number;

  /** Realized profit/loss */
  realizedPnl: number;

  createdAt: number;
  updatedAt: number;
}

// ============================================================
// OrderBook Types (for display)
// ============================================================

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface OrderBook {
  outcomeId: string;
  bids: OrderBookLevel[];  // Sorted by price descending (highest first)
  asks: OrderBookLevel[];  // Sorted by price ascending (lowest first)
  bestBid?: number;
  bestAsk?: number;
  midPrice?: number;
  spread?: number;
  lastTradePrice?: number;
}

// ============================================================
// Storage Types
// ============================================================

export interface StorageData {
  version: number;
  markets: Market[];
  orders: Order[];
  trades: Trade[];
  positions: Position[];
  users: User[];
  currentUserId: string;
}

// ============================================================
// Matching Engine Types
// ============================================================

export interface MatchResult {
  trades: Trade[];
  updatedMakerOrders: Order[];
  takerOrder: Order;
  positionChanges: PositionChange[];
  balanceChanges: BalanceChange[];
}

export interface PositionChange {
  userId: string;
  marketId: string;
  outcomeId: string;
  sharesDelta: number;
  costDelta: number;
}

export interface BalanceChange {
  userId: string;
  cashDelta: number;
  lockedCashDelta: number;
}

// ============================================================
// API Response Types (for internal use)
// ============================================================

export interface PlaceOrderResult {
  success: boolean;
  order?: Order;
  trades?: Trade[];
  error?: string;
}

export interface CancelOrderResult {
  success: boolean;
  error?: string;
}

export interface ResolveMarketResult {
  success: boolean;
  payouts?: { userId: string; amount: number }[];
  error?: string;
}
