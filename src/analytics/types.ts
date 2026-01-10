/**
 * Analytics event types
 */
export type EventType =
  | "pageview"
  | "click"
  | "scroll"
  | "error"
  | "custom"
  | "form_submit"
  | "visibility_change";

/**
 * Configuration for Echoes Analytics
 */
export interface AnalyticsConfig {
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
   * Enable page view tracking
   * @default true
   */
  trackPageViews?: boolean;

  /**
   * Enable click tracking for heatmaps
   * @default true
   */
  trackClicks?: boolean;

  /**
   * Enable scroll depth tracking
   * @default true
   */
  trackScroll?: boolean;

  /**
   * Enable JavaScript error capture
   * @default true
   */
  trackErrors?: boolean;

  /**
   * Enable session recording (requires Pro plan)
   * @default false
   */
  enableRecording?: boolean;

  /**
   * Session timeout in milliseconds (default 30 minutes)
   * @default 1800000
   */
  sessionTimeout?: number;

  /**
   * Number of events to batch before sending
   * @default 10
   */
  batchSize?: number;

  /**
   * Interval in ms to flush events (even if batch not full)
   * @default 5000
   */
  batchInterval?: number;

  /**
   * Mask all input values in recordings
   * @default true
   */
  maskInputs?: boolean;

  /**
   * Mask all text content in recordings
   * @default false
   */
  maskAllText?: boolean;

  /**
   * Maximum recording duration in minutes
   * @default 30
   */
  maxRecordingDuration?: number;

  /**
   * CSS selectors of elements to completely ignore
   */
  ignoredElements?: string[];

  /**
   * CSS selectors of elements to mask in recordings
   */
  maskedElements?: string[];

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Callback when a new session starts
   */
  onSessionStart?: (sessionId: string) => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: Error) => void;
}

/**
 * A tracking event to be sent to the server
 */
export interface TrackingEvent {
  /**
   * Type of event
   */
  type: EventType;

  /**
   * Custom event name (for custom events)
   */
  name?: string;

  /**
   * Unix timestamp in milliseconds
   */
  timestamp: number;

  /**
   * Full URL where the event occurred
   */
  url: string;

  /**
   * Custom properties for the event
   */
  properties?: Record<string, unknown>;

  // Click-specific fields
  /** X coordinate (pixels from left) */
  x?: number;
  /** Y coordinate (pixels from top) */
  y?: number;
  /** X coordinate as percentage of page width (0-100) */
  xPercent?: number;
  /** Y coordinate as percentage of page height (0-100) */
  yPercent?: number;
  /** CSS selector of clicked element */
  selector?: string;
  /** Tag name of clicked element */
  elementTag?: string;
  /** Text content of clicked element */
  elementText?: string;
  /** CSS classes of clicked element */
  elementClasses?: string;
  /** ID of clicked element */
  elementId?: string;

  // Scroll-specific fields
  /** Scroll depth as percentage (0-100) */
  scrollDepth?: number;
  /** Scroll depth in pixels */
  scrollDepthPixels?: number;
  /** Total page height */
  pageHeight?: number;

  // Error-specific fields
  /** Error message */
  errorMessage?: string;
  /** Error stack trace */
  errorStack?: string;
  /** Error type/name */
  errorType?: string;
  /** Source file of error */
  errorSource?: string;
  /** Line number of error */
  errorLine?: number;
  /** Column number of error */
  errorColumn?: number;

  // Pageview-specific fields
  /** Page title */
  pageTitle?: string;
  /** Referrer URL */
  referrer?: string;
  /** Time spent on previous page (seconds) */
  timeOnPage?: number;

  // Visibility change fields
  /** Document visibility state */
  visibilityState?: "visible" | "hidden";
}

/**
 * Session metadata sent with the first batch
 */
export interface SessionMetadata {
  /** User agent string */
  userAgent: string;
  /** Screen width */
  screenWidth: number;
  /** Screen height */
  screenHeight: number;
  /** Viewport width */
  viewportWidth: number;
  /** Viewport height */
  viewportHeight: number;
  /** Browser language */
  language: string;
  /** Referrer URL */
  referrer?: string;
  /** UTM parameters */
  utmParams?: Record<string, string>;
}

/**
 * Batch of events to send to the server
 */
export interface EventBatch {
  /** Client-generated session ID */
  sessionId: string;
  /** Persistent visitor ID */
  visitorId: string;
  /** Optional logged-in user identifier */
  userIdentifier?: string;
  /** Array of events */
  events: TrackingEvent[];
  /** Session metadata (only sent on first batch) */
  session?: SessionMetadata;
}

/**
 * Response from the events API
 */
export interface EventBatchResponse {
  success: boolean;
  /** Number of events accepted */
  accepted: number;
  /** Server-confirmed session ID */
  sessionId: string;
  /** Error message if not successful */
  error?: string;
}

/**
 * Recording chunk to upload
 */
export interface RecordingChunk {
  /** Session ID */
  sessionId: string;
  /** Chunk index (0-based) */
  chunkIndex: number;
  /** Base64-encoded gzip compressed rrweb events */
  events: string;
  /** Start timestamp of chunk */
  startTime: number;
  /** End timestamp of chunk */
  endTime: number;
  /** Whether this is the last chunk */
  isLast: boolean;
}

/**
 * Response from the recording upload API
 */
export interface RecordingChunkResponse {
  success: boolean;
  /** Chunk index that was processed */
  chunkIndex: number;
  /** Error message if not successful */
  error?: string;
}

/**
 * Analytics context value exposed by useEchoesAnalytics hook
 */
export interface AnalyticsContextValue {
  /**
   * Track a custom event
   */
  track: (eventName: string, properties?: Record<string, unknown>) => void;

  /**
   * Identify the current user
   */
  identify: (userId: string, traits?: Record<string, unknown>) => void;

  /**
   * Get the current session ID
   */
  getSessionId: () => string | null;

  /**
   * Get the current visitor ID
   */
  getVisitorId: () => string | null;

  /**
   * Check if recording is currently active
   */
  isRecording: () => boolean;

  /**
   * Manually start recording (if enabled)
   */
  startRecording: () => void;

  /**
   * Manually stop recording
   */
  stopRecording: () => void;

  /**
   * Flush any pending events immediately
   */
  flush: () => Promise<void>;
}
