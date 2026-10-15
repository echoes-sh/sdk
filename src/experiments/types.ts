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
  /** The unit's bucket (0–9999 on servers implementing the 1.2 contract) */
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
  /**
   * "flag" is an experiment whose variations are usually off/on; same machinery.
   * Absent on servers older than the 1.2 contract.
   */
  kind?: ExperimentKind;
  /** Integer 0–100: the share of units that enter at all */
  trafficAllocation: number;
  /**
   * Random at creation; part of the bucketing hash. Changing it reshuffles
   * every unit. Absent (treated as "") on servers older than the 1.2 contract.
   */
  salt?: string;
  /** Always null in v2.0, which the SDK treats as "everyone" */
  targeting: ExperimentTargeting | null;
  variations: VariationConfig[];
}

/**
 * Kind of experiment
 */
export type ExperimentKind = "experiment" | "flag";

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
  /**
   * The unit id used when none is passed to assign/track/getVariation.
   * Defaults to a persisted (when storage allows) random id.
   */
  visitorId?: string;
  userIdentifier?: string;
  timeout?: number;
  debug?: boolean;
  /**
   * Where the visitor id and assignments are persisted.
   * - omitted: `localStorage` when the runtime has one, otherwise in memory
   *   (Node, edge, Convex);
   * - `null` or `false`: in memory only;
   * - an object: your own storage.
   */
  storage?: ExperimentStorage | null | false;
  /**
   * Experiment configurations to start from (e.g. a copy you cached
   * yourself), so that `evaluate` works before any network call.
   * Treated as fresh for the config cache's TTL.
   */
  initialConfig?: ExperimentConfig[];
}

/**
 * Extra options for `assign`
 */
export interface AssignOptions {
  /** Overrides the client's user identifier for this call */
  userIdentifier?: string;
  /** Overrides the browser context sent for this call */
  context?: AssignmentContext;
}

/**
 * Extra options for `track`
 */
export interface TrackOptions {
  /**
   * The unit the event belongs to. Defaults to the client's visitor id.
   * When it differs, the local "assigned?" check is skipped and the server
   * answers 404 if the unit has no stored assignment.
   */
  unitId?: string;
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
