/**
 * Resolution Module - UMA-style Propose/Dispute/Resolve Flow
 *
 * Flow:
 * 1. OPEN -> Market is tradeable
 * 2. CLOSED -> Trading stopped (past endTime)
 * 3. RESOLUTION_PROPOSED -> Admin proposed an outcome, challenge period starts
 * 4. DISPUTED -> Someone disputed the proposal
 * 5. RESOLVED -> Final resolution, payouts processed
 */

import type { Market, ResolutionProposal, Position, User } from './types';
import { storage } from './storage';
import { cancelAllOrdersForMarket } from './matchingEngine';
import { roundPrice } from './helpers';

// Challenge period duration (48 hours in production, 5 minutes for demo)
const CHALLENGE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes for demo

// ============================================================
// Resolution Actions
// ============================================================

/**
 * Close a market for trading (called when endTime passes)
 */
export function closeMarket(marketId: string): { success: boolean; error?: string } {
  const market = storage.getMarket(marketId);
  if (!market) {
    return { success: false, error: 'Market not found' };
  }

  if (market.status !== 'OPEN') {
    return { success: false, error: 'Market is not open' };
  }

  market.status = 'CLOSED';
  market.updatedAt = Date.now();

  // Cancel all open orders and refund locked funds
  cancelAllOrdersForMarket(marketId);

  storage.updateMarket(market);
  return { success: true };
}

/**
 * Propose a resolution outcome (admin only)
 */
export function proposeResolution(
  marketId: string,
  outcomeId: string,
  proposedBy: string = 'Admin'
): { success: boolean; error?: string } {
  const market = storage.getMarket(marketId);
  if (!market) {
    return { success: false, error: 'Market not found' };
  }

  if (market.status !== 'OPEN' && market.status !== 'CLOSED') {
    return { success: false, error: 'Market cannot be proposed for resolution in current state' };
  }

  // Validate outcome exists
  const outcome = market.outcomes.find((o) => o.id === outcomeId);
  if (!outcome) {
    return { success: false, error: 'Invalid outcome' };
  }

  // Close market if still open
  if (market.status === 'OPEN') {
    cancelAllOrdersForMarket(marketId);
  }

  const now = Date.now();

  market.status = 'RESOLUTION_PROPOSED';
  market.resolutionProposal = {
    proposedOutcomeId: outcomeId,
    proposedAt: now,
    proposedBy,
    challengePeriodEndsAt: now + CHALLENGE_PERIOD_MS,
  };
  market.updatedAt = now;

  storage.updateMarket(market);
  return { success: true };
}

/**
 * Dispute a proposed resolution
 */
export function disputeResolution(
  marketId: string,
  reason: string,
  disputedBy: string = 'Anonymous'
): { success: boolean; error?: string } {
  const market = storage.getMarket(marketId);
  if (!market) {
    return { success: false, error: 'Market not found' };
  }

  if (market.status !== 'RESOLUTION_PROPOSED') {
    return { success: false, error: 'Market is not in proposal state' };
  }

  if (!market.resolutionProposal) {
    return { success: false, error: 'No resolution proposal found' };
  }

  // Check if challenge period has ended
  if (Date.now() > market.resolutionProposal.challengePeriodEndsAt) {
    return { success: false, error: 'Challenge period has ended' };
  }

  const now = Date.now();

  market.status = 'DISPUTED';
  market.resolutionProposal.disputedAt = now;
  market.resolutionProposal.disputedBy = disputedBy;
  market.resolutionProposal.disputeReason = reason;
  market.updatedAt = now;

  storage.updateMarket(market);
  return { success: true };
}

/**
 * Finalize resolution (admin decision after dispute, or auto after challenge period)
 */
export function finalizeResolution(
  marketId: string,
  outcomeId?: string // Optional: override outcome (used after dispute)
): { success: boolean; payouts?: { userId: string; amount: number }[]; error?: string } {
  const market = storage.getMarket(marketId);
  if (!market) {
    return { success: false, error: 'Market not found' };
  }

  if (market.status !== 'RESOLUTION_PROPOSED' && market.status !== 'DISPUTED') {
    return { success: false, error: 'Market is not ready for finalization' };
  }

  // Determine winning outcome
  const winningOutcomeId = outcomeId || market.resolutionProposal?.proposedOutcomeId;
  if (!winningOutcomeId) {
    return { success: false, error: 'No outcome specified' };
  }

  // Validate outcome exists
  const winningOutcome = market.outcomes.find((o) => o.id === winningOutcomeId);
  if (!winningOutcome) {
    return { success: false, error: 'Invalid outcome' };
  }

  // If not disputed, check challenge period
  if (market.status === 'RESOLUTION_PROPOSED' && market.resolutionProposal) {
    if (Date.now() < market.resolutionProposal.challengePeriodEndsAt) {
      return { success: false, error: 'Challenge period has not ended' };
    }
  }

  // Process payouts
  const payouts = processPayouts(market, winningOutcomeId);

  // Update market status
  const now = Date.now();
  market.status = 'RESOLVED';
  market.resolvedOutcomeId = winningOutcomeId;
  market.resolvedAt = now;
  market.updatedAt = now;

  // Update winning outcome price to 1.00
  winningOutcome.price = 1.00;
  // Update losing outcomes to 0.00
  for (const outcome of market.outcomes) {
    if (outcome.id !== winningOutcomeId) {
      outcome.price = 0.00;
    }
  }

  storage.updateMarket(market);

  return { success: true, payouts };
}

/**
 * Process payouts for a resolved market
 */
function processPayouts(
  market: Market,
  winningOutcomeId: string
): { userId: string; amount: number }[] {
  const payouts: { userId: string; amount: number }[] = [];

  // Get all positions for this market
  const positions = storage.getPositions({ marketId: market.id });

  // Group by user
  const userPayouts = new Map<string, number>();

  for (const position of positions) {
    if (position.shares <= 0) continue;

    const isWinner = position.outcomeId === winningOutcomeId;
    const payout = isWinner ? position.shares : 0; // $1 per winning share, $0 for losing

    if (payout > 0) {
      const current = userPayouts.get(position.userId) || 0;
      userPayouts.set(position.userId, current + payout);
    }

    // Calculate realized P&L
    const realizedPnl = payout - position.totalCost;

    // Update user
    const allUsers = storage.exportData().users;
    const user = allUsers.find((u) => u.id === position.userId);
    if (user) {
      user.cashBalance += payout;
      user.realizedPnl += realizedPnl;
      user.updatedAt = Date.now();
      storage.updateUser(user);
    }

    // Clear position
    position.shares = 0;
    position.totalCost = 0;
    position.avgCost = 0;
    position.updatedAt = Date.now();
    storage.updatePosition(position);
  }

  // Convert to array
  for (const [userId, amount] of userPayouts) {
    payouts.push({ userId, amount: roundPrice(amount) });
  }

  return payouts;
}

/**
 * Check if a market's challenge period has ended and can be auto-finalized
 */
export function checkAutoFinalize(marketId: string): boolean {
  const market = storage.getMarket(marketId);
  if (!market) return false;

  if (market.status !== 'RESOLUTION_PROPOSED') return false;
  if (!market.resolutionProposal) return false;

  if (Date.now() >= market.resolutionProposal.challengePeriodEndsAt) {
    const result = finalizeResolution(marketId);
    return result.success;
  }

  return false;
}

/**
 * Check if a market should be auto-closed (past endTime)
 */
export function checkAutoClose(marketId: string): boolean {
  const market = storage.getMarket(marketId);
  if (!market) return false;

  if (market.status !== 'OPEN') return false;

  if (Date.now() >= market.endTime) {
    const result = closeMarket(marketId);
    return result.success;
  }

  return false;
}

/**
 * Run auto-checks on all markets
 */
export function runAutoChecks(): void {
  const markets = storage.getMarkets();

  for (const market of markets) {
    if (market.status === 'OPEN') {
      checkAutoClose(market.id);
    } else if (market.status === 'RESOLUTION_PROPOSED') {
      checkAutoFinalize(market.id);
    }
  }
}

// ============================================================
// Resolution Status Helpers
// ============================================================

export function getResolutionStatus(market: Market): {
  canPropose: boolean;
  canDispute: boolean;
  canFinalize: boolean;
  challengeTimeRemaining?: number;
  isDisputed: boolean;
} {
  const now = Date.now();

  const canPropose = market.status === 'OPEN' || market.status === 'CLOSED';

  const canDispute =
    market.status === 'RESOLUTION_PROPOSED' &&
    market.resolutionProposal !== undefined &&
    now < market.resolutionProposal.challengePeriodEndsAt;

  const canFinalize =
    (market.status === 'RESOLUTION_PROPOSED' &&
      market.resolutionProposal !== undefined &&
      now >= market.resolutionProposal.challengePeriodEndsAt) ||
    market.status === 'DISPUTED';

  const challengeTimeRemaining =
    market.status === 'RESOLUTION_PROPOSED' && market.resolutionProposal
      ? Math.max(0, market.resolutionProposal.challengePeriodEndsAt - now)
      : undefined;

  const isDisputed = market.status === 'DISPUTED';

  return {
    canPropose,
    canDispute,
    canFinalize,
    challengeTimeRemaining,
    isDisputed,
  };
}
