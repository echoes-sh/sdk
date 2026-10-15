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
 * The thing a rating is about (a room, an answer, a screen…)
 */
export interface RatingSubject {
  /** Kind of subject, matching `^[a-z0-9_.-]{1,50}$` (e.g. "room") */
  type: string;
  /** The app's id for it, 1–255 characters */
  id: string;
  /**
   * Optional version of the subject, at most 50 characters. Numbers are
   * sent as strings.
   */
  version?: string | number;
}

/**
 * Star values of a rating
 */
export type RatingStars = 1 | 2 | 3 | 4 | 5;

/**
 * An experiment unit a rating belongs to
 */
export interface RatingExperimentRef {
  /** Experiment key */
  key: string;
  /** The unit whose stored assignment the rating is recorded against */
  unitId: string;
}

/**
 * Parameters for `echoes.rate`
 */
export interface RateParams {
  /** What is being rated */
  subject: RatingSubject;
  /**
   * 1–5 stars, or `null` for "asked and dismissed" (send dismissals so that
   * response rates can be read)
   */
  stars: RatingStars | null;
  /** Optional comment, trimmed, at most 2000 characters */
  comment?: string;
  /**
   * Optional user identifier. The same identifier rating the same subject
   * version again replaces the earlier rating.
   */
  userIdentifier?: string;
  /** Optional metadata (≤ 16 KB, as feedback) */
  metadata?: Record<string, unknown>;
  /**
   * Experiment units this rating belongs to. Merged with the experiments the
   * configured experiment client's visitor is in (an entry here wins for the
   * same key).
   */
  experiments?: RatingExperimentRef[];
}

/**
 * Result of `echoes.rate`
 */
export interface RateResult {
  ratingId: string;
  /** True when an earlier rating by the same person was replaced */
  updated: boolean;
}

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
  /** Missing, unknown, malformed, or disabled (revoked) API key */
  INVALID_API_KEY: "INVALID_API_KEY",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  RATE_LIMITED: "RATE_LIMITED",
  /** 403: the request's origin isn't in the project's allowed origins */
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  /** 403: the plan's monthly quota is used up */
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  /** 403 for any other reason */
  FORBIDDEN: "FORBIDDEN",
  /** 404, e.g. "Project not found" */
  NOT_FOUND: "NOT_FOUND",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
