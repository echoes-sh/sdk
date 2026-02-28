// Context and Provider
export { EchoesProvider, useEchoes } from "./context";
export type { EchoesProviderProps } from "./context";

// Analytics Provider
export {
  EchoesAnalyticsProvider,
  useEchoesAnalytics,
  useEchoesAnalyticsSafe,
} from "./analytics-provider";
export type { EchoesAnalyticsProviderProps } from "./analytics-provider";

// Hooks
export { useFeedback } from "./use-feedback";

// Experiment hooks
export {
  ExperimentProvider,
  useExperimentClient,
  useExperiment,
  useVariation,
  useFeatureFlag,
  useActiveExperiments,
  useExperimentIdentify,
} from "./use-experiment";
export type {
  ExperimentProviderProps,
  UseExperimentResult,
} from "./use-experiment";

// Components
export { FeedbackWidget } from "./feedback-widget";
export type { FeedbackWidgetProps } from "./feedback-widget";

// Re-export core types
export type {
  EchoesConfig,
  FeedbackCategory,
  SendFeedbackParams,
  FeedbackResponse,
} from "../types";

// Re-export analytics types
export type {
  AnalyticsConfig,
  AnalyticsContextValue,
  TrackingEvent,
  EventType,
  SessionMetadata,
} from "../analytics/types";

// Re-export experiment types
export type {
  Variation,
  ExperimentClientOptions,
  ActiveExperiments,
} from "../experiments/types";
