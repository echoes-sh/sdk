import type { eventWithTime, recordOptions } from "rrweb";
import type { SessionManager } from "./session-manager";
import { compressToBase64, estimateStringSize } from "./compression";

// Type for the stop function returned by rrweb's record()
type StopRecordingFn = (() => void) | undefined;

// ============================================================================
// TYPES
// ============================================================================

interface RecordingManagerConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the API */
  baseUrl: string;
  /** Session manager instance */
  sessionManager: SessionManager;
  /** Maximum recording duration in minutes */
  maxDurationMinutes: number;
  /** Chunk size in events (how many events to batch before uploading) */
  chunkSize?: number;
  /** Flush interval in ms */
  flushInterval?: number;
  /** Mask all text content */
  maskAllText?: boolean;
  /** Mask all input values */
  maskInputs?: boolean;
  /** CSS selectors of elements to mask */
  maskedElements?: string[];
  /** CSS selectors of elements to ignore completely */
  ignoredElements?: string[];
  /** Enable debug logging */
  debug?: boolean;
  /** Callback on error */
  onError?: (error: Error) => void;
}

interface RecordingChunk {
  sessionId: string;
  chunkIndex: number;
  events: string; // Base64 gzip compressed
  eventCount: number;
  startTime: number;
  endTime: number;
  isLast: boolean;
}

interface RecordingChunkResponse {
  success: boolean;
  chunkIndex: number;
  error?: string;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CHUNK_SIZE = 100; // events per chunk
const DEFAULT_FLUSH_INTERVAL = 30000; // 30 seconds
const MAX_EVENTS_BUFFER = 500; // Maximum events to hold before force flush

// ============================================================================
// RECORDING MANAGER
// ============================================================================

/**
 * Manages session recording using rrweb
 */
export class RecordingManager {
  private config: Required<RecordingManagerConfig>;
  private events: eventWithTime[] = [];
  private chunkIndex: number = 0;
  private startTime: number = 0;
  private stopFn: StopRecordingFn = undefined;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isRecording: boolean = false;
  private isFlushing: boolean = false;
  private destroyed: boolean = false;
  private recordingStartTime: number = 0;
  private maxDurationMs: number;

  constructor(config: RecordingManagerConfig) {
    this.config = {
      ...config,
      chunkSize: config.chunkSize ?? DEFAULT_CHUNK_SIZE,
      flushInterval: config.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
      maskAllText: config.maskAllText ?? false,
      maskInputs: config.maskInputs ?? true,
      maskedElements: config.maskedElements ?? [],
      ignoredElements: config.ignoredElements ?? [],
      debug: config.debug ?? false,
      onError: config.onError ?? (() => {}),
    };

    this.maxDurationMs = config.maxDurationMinutes * 60 * 1000;
  }

  /**
   * Starts recording the session
   */
  async start(): Promise<void> {
    if (this.isRecording || this.destroyed) {
      this.log("Recording already active or destroyed");
      return;
    }

    if (typeof window === "undefined") {
      this.log("Cannot record on server side");
      return;
    }

    try {
      // Dynamically import rrweb to support tree-shaking
      const { record } = await import("rrweb");

      this.isRecording = true;
      this.recordingStartTime = Date.now();
      this.startTime = Date.now();
      this.events = [];
      this.chunkIndex = 0;

      // Build rrweb config
      const rrwebConfig: recordOptions<eventWithTime> = {
        emit: (event: eventWithTime) => {
          this.handleEvent(event);
        },
        maskAllInputs: this.config.maskInputs,
        maskTextSelector: this.config.maskAllText ? "*" : undefined,
        blockSelector: this.config.ignoredElements.join(", ") || undefined,
        maskInputOptions: {
          password: true,
          email: true,
          tel: true,
          text: this.config.maskInputs,
          textarea: this.config.maskInputs,
          select: false,
        },
        // Privacy-focused defaults
        inlineStylesheet: true,
        collectFonts: false,
        recordCanvas: false,
        recordCrossOriginIframes: false,
        // Sampling to reduce data
        sampling: {
          mousemove: true,
          mouseInteraction: true,
          scroll: 150, // Throttle scroll events
          media: 800,
          input: "last", // Only capture last input value
        },
        // Hooks for additional masking
        maskTextFn: this.config.maskedElements.length > 0
          ? (text: string, element: HTMLElement | null) => {
              if (element && this.shouldMaskElement(element)) {
                return "•".repeat(Math.min(text.length, 20));
              }
              return text;
            }
          : undefined,
      };

      // Start recording
      this.stopFn = record(rrwebConfig);

      // Start flush timer
      this.startFlushTimer();

      // Set up max duration timeout
      setTimeout(() => {
        if (this.isRecording) {
          this.log("Max recording duration reached, stopping");
          this.stop();
        }
      }, this.maxDurationMs);

      this.log("Recording started");
    } catch (error) {
      this.log("Failed to start recording:", error);
      this.config.onError(error instanceof Error ? error : new Error(String(error)));
      this.isRecording = false;
    }
  }

  /**
   * Stops recording and flushes remaining events
   */
  async stop(): Promise<void> {
    if (!this.isRecording || this.destroyed) {
      return;
    }

    this.log("Stopping recording");

    // Stop rrweb recording
    if (this.stopFn) {
      this.stopFn();
      this.stopFn = undefined;
    }

    // Stop flush timer
    this.stopFlushTimer();

    // Final flush with isLast = true
    await this.flush(true);

    this.isRecording = false;
    this.log("Recording stopped");
  }

  /**
   * Checks if recording is active
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Gets the recording duration in seconds
   */
  getDuration(): number {
    if (!this.isRecording) return 0;
    return Math.round((Date.now() - this.recordingStartTime) / 1000);
  }

  /**
   * Handles incoming rrweb events
   */
  private handleEvent(event: eventWithTime): void {
    if (this.destroyed || !this.isRecording) return;

    this.events.push(event);

    // Flush if we've accumulated enough events
    if (this.events.length >= MAX_EVENTS_BUFFER) {
      this.flush();
    }
  }

  /**
   * Checks if an element should be masked
   */
  private shouldMaskElement(element: HTMLElement): boolean {
    for (const selector of this.config.maskedElements) {
      try {
        if (element.matches(selector) || element.closest(selector)) {
          return true;
        }
      } catch {
        // Invalid selector
      }
    }
    return false;
  }

  /**
   * Starts the automatic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      if (this.events.length > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  /**
   * Stops the flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Flushes events to the server
   */
  async flush(isLast: boolean = false): Promise<void> {
    if (this.destroyed || this.isFlushing || this.events.length === 0) {
      return;
    }

    this.isFlushing = true;

    // Take events from buffer
    const eventsToSend = [...this.events];
    this.events = [];

    const chunkStartTime = this.startTime;
    const chunkEndTime = Date.now();
    this.startTime = chunkEndTime;

    try {
      // Serialize events
      const serialized = JSON.stringify(eventsToSend);

      // Compress events
      const compressed = await compressToBase64(serialized);

      const chunk: RecordingChunk = {
        sessionId: this.config.sessionManager.getSessionId(),
        chunkIndex: this.chunkIndex,
        events: compressed,
        eventCount: eventsToSend.length,
        startTime: chunkStartTime,
        endTime: chunkEndTime,
        isLast,
      };

      await this.uploadChunk(chunk);

      this.chunkIndex++;
      this.log(
        `Chunk ${chunk.chunkIndex} uploaded:`,
        eventsToSend.length,
        "events,",
        Math.round(estimateStringSize(serialized) / 1024),
        "KB uncompressed"
      );
    } catch (error) {
      this.log("Failed to flush chunk:", error);
      // Re-add events to buffer for retry (at the beginning)
      this.events = [...eventsToSend, ...this.events];
      this.config.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Uploads a chunk to the server
   */
  private async uploadChunk(chunk: RecordingChunk): Promise<void> {
    const response = await fetch(
      `${this.config.baseUrl}/api/v1/analytics/recordings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify(chunk),
        keepalive: true,
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `HTTP ${response.status}: ${(errorData as { error?: string }).error || response.statusText}`
      );
    }

    const data: RecordingChunkResponse = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Unknown error uploading recording chunk");
    }
  }

  /**
   * Destroys the recording manager
   */
  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;

    if (this.isRecording) {
      // Stop recording synchronously
      if (this.stopFn) {
        this.stopFn();
        this.stopFn = undefined;
      }
      this.stopFlushTimer();

      // Try to send final chunk via sendBeacon
      if (this.events.length > 0) {
        this.sendBeaconFlush();
      }
    }

    this.log("Recording manager destroyed");
  }

  /**
   * Synchronous flush using fetch with keepalive for use in unload handlers
   * Uses fetch instead of sendBeacon to support custom headers (keeps API key secure)
   */
  private sendBeaconFlush(): void {
    try {
      const serialized = JSON.stringify(this.events);

      // Can't do async compression in unload, send uncompressed
      const chunk: RecordingChunk = {
        sessionId: this.config.sessionManager.getSessionId(),
        chunkIndex: this.chunkIndex,
        events: btoa(unescape(encodeURIComponent(serialized))), // Simple base64
        eventCount: this.events.length,
        startTime: this.startTime,
        endTime: Date.now(),
        isLast: true,
      };

      // Use fetch with keepalive instead of sendBeacon to support headers
      fetch(`${this.config.baseUrl}/api/v1/analytics/recordings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify(chunk),
        keepalive: true,
      }).catch(() => {
        // Silently fail - this is a best-effort send during page unload
      });

      this.log("Final chunk sent via keepalive fetch");
    } catch (error) {
      this.log("Beacon flush failed:", error);
    }
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log("[Echoes:RecordingManager]", ...args);
    }
  }
}
