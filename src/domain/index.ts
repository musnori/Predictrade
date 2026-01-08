/**
 * Domain Layer - Public API
 */

// Types
export * from './types';

// Helpers
export * from './helpers';

// Storage
export { storage } from './storage';

// Matching Engine
export {
  placeOrder,
  cancelOrder,
  cancelAllOrdersForMarket,
  getOrderBookSummary,
  getDisplayPrice,
} from './matchingEngine';

// Resolution
export {
  closeMarket,
  proposeResolution,
  disputeResolution,
  finalizeResolution,
  checkAutoClose,
  checkAutoFinalize,
  runAutoChecks,
  getResolutionStatus,
} from './resolution';
