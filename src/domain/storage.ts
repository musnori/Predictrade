/**
 * Storage Layer - localStorage with versioning and migration
 */

import type {
  Market,
  Order,
  Trade,
  Position,
  User,
  StorageData,
} from './types';
import { createUser, generateUserId } from './helpers';

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY = 'predictrade_v2';
const CURRENT_VERSION = 1;

// ============================================================
// Migration Functions
// ============================================================

type MigrationFn = (data: unknown) => StorageData;

const migrations: Record<number, MigrationFn> = {
  // Add migrations here as needed:
  // 1: (data) => { /* migrate from v0 to v1 */ return data as StorageData; },
};

function migrate(data: unknown, fromVersion: number): StorageData {
  let current = data;
  let version = fromVersion;

  while (version < CURRENT_VERSION) {
    const migrationFn = migrations[version + 1];
    if (migrationFn) {
      current = migrationFn(current);
    }
    version++;
  }

  return current as StorageData;
}

// ============================================================
// Default Data
// ============================================================

function createDefaultData(): StorageData {
  const user = createUser('Anonymous');
  return {
    version: CURRENT_VERSION,
    markets: [],
    orders: [],
    trades: [],
    positions: [],
    users: [user],
    currentUserId: user.id,
  };
}

// ============================================================
// Storage Class
// ============================================================

class Storage {
  private data: StorageData;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.data = this.load();
  }

  private load(): StorageData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return createDefaultData();
      }

      const parsed = JSON.parse(raw);
      const version = parsed.version || 0;

      if (version < CURRENT_VERSION) {
        const migrated = migrate(parsed, version);
        this.saveImmediate(migrated);
        return migrated;
      }

      return parsed as StorageData;
    } catch (error) {
      console.error('Failed to load storage, creating fresh data:', error);
      return createDefaultData();
    }
  }

  private saveImmediate(data?: StorageData): void {
    try {
      const toSave = data || this.data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (error) {
      console.error('Failed to save storage:', error);
    }
  }

  /** Debounced save to prevent excessive writes */
  save(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveImmediate();
      this.saveDebounceTimer = null;
    }, 100);
  }

  /** Force immediate save */
  flush(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    this.saveImmediate();
  }

  // ============================================================
  // User Operations
  // ============================================================

  getCurrentUser(): User {
    const user = this.data.users.find((u) => u.id === this.data.currentUserId);
    if (!user) {
      // Create a new user if current doesn't exist
      const newUser = createUser('Anonymous');
      this.data.users.push(newUser);
      this.data.currentUserId = newUser.id;
      this.save();
      return newUser;
    }
    return user;
  }

  updateUser(user: User): void {
    const index = this.data.users.findIndex((u) => u.id === user.id);
    if (index >= 0) {
      this.data.users[index] = { ...user, updatedAt: Date.now() };
    } else {
      this.data.users.push(user);
    }
    this.save();
  }

  resetWallet(): void {
    const user = this.getCurrentUser();
    user.cashBalance = 1000.00;
    user.lockedCash = 0;
    user.realizedPnl = 0;
    user.updatedAt = Date.now();
    this.updateUser(user);
  }

  // ============================================================
  // Market Operations
  // ============================================================

  getMarkets(): Market[] {
    return this.data.markets;
  }

  getMarket(id: string): Market | undefined {
    return this.data.markets.find((m) => m.id === id);
  }

  addMarket(market: Market): void {
    this.data.markets.push(market);
    this.save();
  }

  updateMarket(market: Market): void {
    const index = this.data.markets.findIndex((m) => m.id === market.id);
    if (index >= 0) {
      this.data.markets[index] = { ...market, updatedAt: Date.now() };
      this.save();
    }
  }

  deleteMarket(id: string): void {
    this.data.markets = this.data.markets.filter((m) => m.id !== id);
    // Also delete related orders, trades, positions
    this.data.orders = this.data.orders.filter((o) => o.marketId !== id);
    this.data.trades = this.data.trades.filter((t) => t.marketId !== id);
    this.data.positions = this.data.positions.filter((p) => p.marketId !== id);
    this.save();
  }

  // ============================================================
  // Order Operations
  // ============================================================

  getOrders(filter?: { marketId?: string; userId?: string; status?: Order['status'] }): Order[] {
    let orders = this.data.orders;

    if (filter?.marketId) {
      orders = orders.filter((o) => o.marketId === filter.marketId);
    }
    if (filter?.userId) {
      orders = orders.filter((o) => o.userId === filter.userId);
    }
    if (filter?.status) {
      orders = orders.filter((o) => o.status === filter.status);
    }

    return orders;
  }

  getOrder(id: string): Order | undefined {
    return this.data.orders.find((o) => o.id === id);
  }

  getOpenOrders(marketId: string, outcomeId: string): Order[] {
    return this.data.orders.filter(
      (o) =>
        o.marketId === marketId &&
        o.outcomeId === outcomeId &&
        (o.status === 'OPEN' || o.status === 'PARTIAL') &&
        o.remaining > 0
    );
  }

  addOrder(order: Order): void {
    this.data.orders.push(order);
    this.save();
  }

  updateOrder(order: Order): void {
    const index = this.data.orders.findIndex((o) => o.id === order.id);
    if (index >= 0) {
      this.data.orders[index] = { ...order, updatedAt: Date.now() };
      this.save();
    }
  }

  updateOrders(orders: Order[]): void {
    for (const order of orders) {
      const index = this.data.orders.findIndex((o) => o.id === order.id);
      if (index >= 0) {
        this.data.orders[index] = { ...order, updatedAt: Date.now() };
      }
    }
    this.save();
  }

  // ============================================================
  // Trade Operations
  // ============================================================

  getTrades(filter?: { marketId?: string; userId?: string }): Trade[] {
    let trades = this.data.trades;

    if (filter?.marketId) {
      trades = trades.filter((t) => t.marketId === filter.marketId);
    }
    if (filter?.userId) {
      trades = trades.filter(
        (t) => t.makerId === filter.userId || t.takerId === filter.userId
      );
    }

    return trades.sort((a, b) => b.createdAt - a.createdAt);
  }

  getLastTradePrice(marketId: string, outcomeId: string): number | undefined {
    const trades = this.data.trades
      .filter((t) => t.marketId === marketId && t.outcomeId === outcomeId)
      .sort((a, b) => b.createdAt - a.createdAt);

    return trades[0]?.price;
  }

  addTrades(trades: Trade[]): void {
    this.data.trades.push(...trades);
    this.save();
  }

  // ============================================================
  // Position Operations
  // ============================================================

  getPositions(filter?: { userId?: string; marketId?: string }): Position[] {
    let positions = this.data.positions;

    if (filter?.userId) {
      positions = positions.filter((p) => p.userId === filter.userId);
    }
    if (filter?.marketId) {
      positions = positions.filter((p) => p.marketId === filter.marketId);
    }

    return positions;
  }

  getPosition(userId: string, marketId: string, outcomeId: string): Position | undefined {
    return this.data.positions.find(
      (p) => p.userId === userId && p.marketId === marketId && p.outcomeId === outcomeId
    );
  }

  updatePosition(position: Position): void {
    const index = this.data.positions.findIndex(
      (p) =>
        p.userId === position.userId &&
        p.marketId === position.marketId &&
        p.outcomeId === position.outcomeId
    );

    if (index >= 0) {
      this.data.positions[index] = { ...position, updatedAt: Date.now() };
    } else {
      this.data.positions.push({ ...position, updatedAt: Date.now() });
    }
    this.save();
  }

  // ============================================================
  // Bulk Operations
  // ============================================================

  /**
   * Apply multiple changes atomically
   * Used by matching engine to ensure consistency
   */
  applyChanges(changes: {
    orders?: Order[];
    trades?: Trade[];
    positions?: Position[];
    user?: User;
  }): void {
    if (changes.orders) {
      for (const order of changes.orders) {
        const index = this.data.orders.findIndex((o) => o.id === order.id);
        if (index >= 0) {
          this.data.orders[index] = order;
        } else {
          this.data.orders.push(order);
        }
      }
    }

    if (changes.trades) {
      this.data.trades.push(...changes.trades);
    }

    if (changes.positions) {
      for (const position of changes.positions) {
        const index = this.data.positions.findIndex(
          (p) =>
            p.userId === position.userId &&
            p.marketId === position.marketId &&
            p.outcomeId === position.outcomeId
        );

        if (index >= 0) {
          this.data.positions[index] = position;
        } else {
          this.data.positions.push(position);
        }
      }
    }

    if (changes.user) {
      const index = this.data.users.findIndex((u) => u.id === changes.user!.id);
      if (index >= 0) {
        this.data.users[index] = changes.user;
      }
    }

    this.save();
  }

  // ============================================================
  // Admin Operations
  // ============================================================

  /** Check if admin mode is enabled */
  isAdminMode(): boolean {
    return localStorage.getItem('predictrade_admin') === 'true';
  }

  /** Toggle admin mode */
  setAdminMode(enabled: boolean): void {
    if (enabled) {
      localStorage.setItem('predictrade_admin', 'true');
    } else {
      localStorage.removeItem('predictrade_admin');
    }
  }

  /** Export all data (for debugging) */
  exportData(): StorageData {
    return JSON.parse(JSON.stringify(this.data));
  }

  /** Import data (for debugging) */
  importData(data: StorageData): void {
    this.data = data;
    this.saveImmediate();
  }

  /** Clear all data and reset */
  clearAll(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.data = createDefaultData();
    this.saveImmediate();
  }
}

// ============================================================
// Singleton Export
// ============================================================

export const storage = new Storage();
