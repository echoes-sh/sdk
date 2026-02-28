import type { ExperimentClient, ActiveExperiments } from "./experiments";

/**
 * Feedback category types
 */
export type FeedbackCategory = "bug" | "feature" | "question" | "praise";

/**
 * Experiment context injected into feedback metadata
 */
export interface ExperimentContext {
  [experimentKey: string]: {
    variationKey: string;
    assignmentId: string;
  };
}

export type { ExperimentClient, ActiveExperiments };

/**
 * Configuration options for the Echoes client
 */
export interface EchoesConfig {
  /**
   * Your Echoes API key (starts with ek_live_ or ek_test_)
   */
  apiKey: string;

  /**
   * Base URL for the Echoes API
   * @default "https://echoes.sh"
   */
  baseUrl?: string;

  /**
   * Default user identifier to attach to all feedback
   */
  defaultUserIdentifier?: string;

  /**
   * Default metadata to merge with all feedback
   */
  defaultMetadata?: Record<string, unknown>;

  /**
   * Timeout for API requests in milliseconds
   * @default 10000
   */
  timeout?: number;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Experiment client for automatic experiment context injection
   * When provided, active experiments will be automatically added to feedback metadata
   */
  experimentClient?: ExperimentClient;
}

/**
 * Parameters for sending feedback
 */
export interface SendFeedbackParams {
  /**
   * Category of the feedback
   */
  category: FeedbackCategory;

  /**
   * The feedback message content
   */
  message: string;

  /**
   * Optional user identifier (email, user ID, etc.)
   */
  userIdentifier?: string;

  /**
   * Optional metadata to attach to the feedback
   */
  metadata?: Record<string, unknown>;
}

/**
 * Successful feedback submission response
 */
export interface FeedbackSuccessResponse {
  success: true;
  feedbackId: string;
}

/**
 * Failed feedback submission response
 */
export interface FeedbackErrorResponse {
  success: false;
  error: string;
}

/**
 * Feedback submission response
 */
export type FeedbackResponse = FeedbackSuccessResponse | FeedbackErrorResponse;

/**
 * Error thrown by the Echoes client
 */
export class EchoesError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;

  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = "EchoesError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Error codes
 */
export const ErrorCodes = {
  INVALID_API_KEY: "INVALID_API_KEY",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  RATE_LIMITED: "RATE_LIMITED",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
