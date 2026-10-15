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
  RatingSubject,
  RatingStars,
  RatingExperimentRef,
  RateParams,
  RateResult,
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
  bucket10k,
  variationBucket,
  pickVariation,
  evaluateExperiment,
  evaluateExperimentDetailed,
  createMemoryStorage,
  BUCKET_COUNT,
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
  ExperimentKind,
  AssignOptions,
  TrackOptions,
  EvaluationDetail,
} from "./experiments";
