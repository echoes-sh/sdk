/**
 * Configuration for a variation
 */
export interface VariationConfiguration {
  [key: string]: unknown;
}

/**
 * Variation data returned from assignment
 */
export interface Variation {
  key: string;
  name: string;
  configuration: VariationConfiguration | null;
}

/**
 * Assignment result from the API
 */
export interface AssignmentResult {
  success: boolean;
  assigned: boolean;
  variation: Variation | null;
  bucketValue: number | null;
  isNewAssignment: boolean;
  assignmentId?: string;
}

/**
 * Track event result
 */
export interface TrackResult {
  success: boolean;
  error?: string;
}

/**
 * Experiment configuration from config endpoint
 */
export interface ExperimentConfig {
  key: string;
  name: string;
  trafficAllocation: number;
  targeting: ExperimentTargeting | null;
  variations: VariationConfig[];
}

/**
 * Variation configuration from config endpoint
 */
export interface VariationConfig {
  key: string;
  name: string;
  weight: number;
  isControl: boolean;
  configuration: VariationConfiguration | null;
}

/**
 * Experiment targeting configuration
 */
export interface ExperimentTargeting {
  userSegments?: string[];
  countries?: string[];
  deviceTypes?: ("desktop" | "mobile" | "tablet")[];
  customAttributes?: Record<string, string | string[]>;
}

/**
 * Config endpoint response
 */
export interface ConfigResponse {
  success: boolean;
  experiments: ExperimentConfig[];
  message?: string;
}

/**
 * Context for assignment
 */
export interface AssignmentContext {
  deviceType?: string;
  browser?: string;
  os?: string;
  country?: string;
  language?: string;
  userAgent?: string;
  [key: string]: unknown;
}

/**
 * Options for ExperimentClient
 */
export interface ExperimentClientOptions {
  apiKey: string;
  baseUrl?: string;
  visitorId?: string;
  userIdentifier?: string;
  timeout?: number;
  debug?: boolean;
}

/**
 * Storage interface for persisting assignments
 */
export interface ExperimentStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Cached assignment data
 */
export interface CachedAssignment {
  variationKey: string;
  assignmentId: string;
  timestamp: number;
}

/**
 * Active experiment assignments map
 */
export interface ActiveExperiments {
  [experimentKey: string]: {
    variationKey: string;
    assignmentId: string;
  };
}
