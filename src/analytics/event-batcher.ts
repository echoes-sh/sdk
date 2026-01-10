import type { SessionManager } from "./session-manager";
import type {
  TrackingEvent,
  EventBatch,
  EventBatchResponse,
} from "./types";

interface EventBatcherConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the API */
  baseUrl?: string;
  /** Number of events to batch before sending */
  batchSize: number;
  /** Interval in ms to flush events */
  batchInterval: number;
  /** Session manager instance */
  sessionManager: SessionManager;
  /** Enable debug logging */
  debug?: boolean;
  /** Callback on error */
  onError?: (error: Error) => void;
}

const DEFAULT_BASE_URL = "https://echoes.sh";
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Batches and sends tracking events to the server
 */
export class EventBatcher {
  private queue: TrackingEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: EventBatcherConfig;
  private isFlushing: boolean = false;
  private retryQueue: TrackingEvent[] = [];
  private destroyed: boolean = false;

  constructor(config: EventBatcherConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE_URL,
    };

    this.startTimer();
    this.setupUnloadHandler();
  }

  /**
   * Adds an event to the queue
   */
  add(event: TrackingEvent): void {
    if (this.destroyed) return;

    this.queue.push(event);
    this.log("Event added to queue:", event.type, "Queue size:", this.queue.length);

    // Flush immediately if batch is full
    if (this.queue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Starts the flush timer
   */
  private startTimer(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      if (this.queue.length > 0) {
        this.flush();
      }
    }, this.config.batchInterval);
  }

  /**
   * Sets up page unload handler to flush remaining events
   */
  private setupUnloadHandler(): void {
    if (typeof window === "undefined") return;

    // Use multiple events for maximum compatibility
    const flushOnUnload = () => this.flushSync();

    window.addEventListener("beforeunload", flushOnUnload);
    window.addEventListener("pagehide", flushOnUnload);
    window.addEventListener("unload", flushOnUnload);

    // Also flush when tab is hidden (mobile browsers)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.flush();
      }
    });
  }

  /**
   * Flushes the queue asynchronously
   */
  async flush(): Promise<void> {
    if (this.destroyed || this.isFlushing || this.queue.length === 0) return;

    this.isFlushing = true;

    // Take all events from queue
    const events = [...this.queue];
    this.queue = [];

    // Add any retry events
    if (this.retryQueue.length > 0) {
      events.unshift(...this.retryQueue);
      this.retryQueue = [];
    }

    try {
      await this.sendBatch(events);
    } catch (error) {
      this.log("Flush failed, requeueing events:", error);
      // Requeue events for retry (limit to avoid infinite growth)
      this.retryQueue = events.slice(0, this.config.batchSize * 3);
      this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Synchronous flush for use in unload handlers
   * Uses sendBeacon for reliability
   */
  private flushSync(): void {
    if (this.destroyed || this.queue.length === 0) return;

    const events = [...this.queue, ...this.retryQueue];
    this.queue = [];
    this.retryQueue = [];

    if (events.length === 0) return;

    this.sendBeacon(events);
  }

  /**
   * Sends a batch of events to the server
   */
  private async sendBatch(
    events: TrackingEvent[],
    attempt: number = 1
  ): Promise<void> {
    const sessionManager = this.config.sessionManager;

    const payload: EventBatch = {
      sessionId: sessionManager.getSessionId(),
      visitorId: sessionManager.getVisitorId(),
      userIdentifier: sessionManager.getUserIdentifier() ?? undefined,
      events,
    };

    // Include session metadata on first batch
    if (sessionManager.isFirstBatchForSession()) {
      payload.session = sessionManager.getSessionMetadata();
    }

    this.log("Sending batch:", events.length, "events");

    try {
      const response = await fetch(
        `${this.config.baseUrl}/api/v1/analytics/events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
          },
          body: JSON.stringify(payload),
          keepalive: true,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `HTTP ${response.status}: ${(errorData as { error?: string }).error || response.statusText}`
        );
      }

      const data: EventBatchResponse = await response.json();

      if (data.success) {
        sessionManager.markFirstBatchSent();
        this.log("Batch sent successfully:", data.accepted, "events accepted");
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (error) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        this.log(`Retry attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}`);
        await this.delay(RETRY_DELAY_MS * attempt);
        return this.sendBatch(events, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Sends events using the Beacon API (for unload handlers)
   */
  private sendBeacon(events: TrackingEvent[]): boolean {
    if (typeof navigator === "undefined" || !navigator.sendBeacon) {
      // Fallback to sync XHR if sendBeacon not available
      this.sendSyncXHR(events);
      return true;
    }

    const sessionManager = this.config.sessionManager;

    const payload: EventBatch = {
      sessionId: sessionManager.getSessionId(),
      visitorId: sessionManager.getVisitorId(),
      userIdentifier: sessionManager.getUserIdentifier() ?? undefined,
      events,
    };

    if (sessionManager.isFirstBatchForSession()) {
      payload.session = sessionManager.getSessionMetadata();
    }

    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/json",
    });

    // sendBeacon doesn't support custom headers, so we need to include
    // the API key in the URL or use a different approach
    // For now, we'll send it as a query parameter (the server should support this)
    const url = `${this.config.baseUrl}/api/v1/analytics/events?apiKey=${encodeURIComponent(this.config.apiKey)}`;

    const success = navigator.sendBeacon(url, blob);
    this.log("Beacon sent:", success ? "success" : "failed");

    if (success) {
      sessionManager.markFirstBatchSent();
    }

    return success;
  }

  /**
   * Fallback synchronous XHR for older browsers
   */
  private sendSyncXHR(events: TrackingEvent[]): void {
    if (typeof XMLHttpRequest === "undefined") return;

    const sessionManager = this.config.sessionManager;

    const payload: EventBatch = {
      sessionId: sessionManager.getSessionId(),
      visitorId: sessionManager.getVisitorId(),
      userIdentifier: sessionManager.getUserIdentifier() ?? undefined,
      events,
    };

    if (sessionManager.isFirstBatchForSession()) {
      payload.session = sessionManager.getSessionMetadata();
    }

    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.config.baseUrl}/api/v1/analytics/events`, false);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("x-api-key", this.config.apiKey);
      xhr.send(JSON.stringify(payload));

      if (xhr.status >= 200 && xhr.status < 300) {
        sessionManager.markFirstBatchSent();
      }
    } catch (error) {
      this.log("Sync XHR failed:", error);
    }
  }

  /**
   * Helper to create a delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Gets the current queue size
   */
  getQueueSize(): number {
    return this.queue.length + this.retryQueue.length;
  }

  /**
   * Destroys the batcher, flushing remaining events
   */
  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Final flush
    this.flushSync();
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log("[Echoes:EventBatcher]", ...args);
    }
  }
}
