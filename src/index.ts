// Core client
export { Echoes, createEchoes } from "./client";

// Types
export type {
  EchoesConfig,
  FeedbackCategory,
  SendFeedbackParams,
  FeedbackResponse,
  FeedbackSuccessResponse,
  FeedbackErrorResponse,
} from "./types";

export { EchoesError, ErrorCodes } from "./types";
export type { ErrorCode } from "./types";

// Analytics exports
export * from "./analytics";

// Experiments exports
export {
  ExperimentClient,
  createExperimentClient,
  murmur3,
  hashToBucket,
  generateVisitorId,
} from "./experiments";
export type {
  Variation,
  AssignmentResult,
  TrackResult,
  ExperimentConfig,
  VariationConfig,
  ExperimentTargeting,
  ConfigResponse,
  AssignmentContext,
  ExperimentClientOptions,
  ExperimentStorage,
  CachedAssignment,
  ActiveExperiments,
  VariationConfiguration,
} from "./experiments";
