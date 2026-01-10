import type { SessionMetadata } from "./types";

interface SessionManagerConfig {
  /** Session timeout in milliseconds */
  timeout: number;
  /** Callback when a new session starts */
  onSessionStart?: (sessionId: string) => void;
  /** Enable debug logging */
  debug?: boolean;
}

interface StoredSession {
  sessionId: string;
  lastActivity: number;
}

const VISITOR_ID_KEY = "echoes_visitor_id";
const SESSION_KEY = "echoes_session";

/**
 * Generates a simple fingerprint for visitor identification
 * This is NOT meant to be a tracking fingerprint, just a way to
 * identify returning visitors for analytics purposes
 */
function generateVisitorId(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generates a unique session ID
 */
function generateSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Extracts UTM parameters from the current URL
 */
function extractUtmParams(): Record<string, string> {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const utmParams: Record<string, string> = {};

  const utmKeys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ];

  for (const key of utmKeys) {
    const value = params.get(key);
    if (value) {
      utmParams[key] = value;
    }
  }

  return utmParams;
}

/**
 * Manages session lifecycle for analytics tracking
 */
export class SessionManager {
  private sessionId: string | null = null;
  private visitorId: string;
  private userIdentifier: string | null = null;
  private userTraits: Record<string, unknown> = {};
  private lastActivity: number = Date.now();
  private timeout: number;
  private onSessionStart?: (sessionId: string) => void;
  private debug: boolean;
  private isFirstBatch: boolean = true;
  private activityListenersAttached: boolean = false;

  constructor(config: SessionManagerConfig) {
    this.timeout = config.timeout;
    this.onSessionStart = config.onSessionStart;
    this.debug = config.debug ?? false;

    // Initialize visitor ID (persistent)
    this.visitorId = this.getOrCreateVisitorId();

    // Restore or start session
    this.restoreOrStartSession();

    // Set up activity listeners
    this.setupActivityListeners();
  }

  /**
   * Gets or creates a persistent visitor ID
   */
  private getOrCreateVisitorId(): string {
    if (typeof window === "undefined") {
      return generateVisitorId();
    }

    try {
      const stored = localStorage.getItem(VISITOR_ID_KEY);
      if (stored) {
        this.log("Restored visitor ID:", stored);
        return stored;
      }

      const newId = generateVisitorId();
      localStorage.setItem(VISITOR_ID_KEY, newId);
      this.log("Created new visitor ID:", newId);
      return newId;
    } catch {
      // localStorage might be unavailable (private browsing, etc.)
      this.log("localStorage unavailable, using ephemeral visitor ID");
      return generateVisitorId();
    }
  }

  /**
   * Restores an existing session or starts a new one
   */
  private restoreOrStartSession(): void {
    if (typeof window === "undefined") {
      this.startNewSession();
      return;
    }

    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const data: StoredSession = JSON.parse(stored);
        const timeSinceActivity = Date.now() - data.lastActivity;

        if (timeSinceActivity < this.timeout) {
          // Session is still valid
          this.sessionId = data.sessionId;
          this.lastActivity = data.lastActivity;
          this.isFirstBatch = false; // Session was restored, metadata already sent
          this.log("Restored session:", this.sessionId);
          return;
        }
      }
    } catch {
      // sessionStorage might be unavailable
    }

    this.startNewSession();
  }

  /**
   * Starts a new session
   */
  private startNewSession(): void {
    this.sessionId = generateSessionId();
    this.lastActivity = Date.now();
    this.isFirstBatch = true;
    this.persistSession();
    this.log("Started new session:", this.sessionId);
    this.onSessionStart?.(this.sessionId);
  }

  /**
   * Persists session to sessionStorage
   */
  private persistSession(): void {
    if (typeof window === "undefined") return;

    try {
      const data: StoredSession = {
        sessionId: this.sessionId!,
        lastActivity: this.lastActivity,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {
      // sessionStorage might be unavailable
    }
  }

  /**
   * Sets up activity listeners to track session activity
   */
  private setupActivityListeners(): void {
    if (typeof window === "undefined" || this.activityListenersAttached) return;

    const updateActivity = () => {
      const now = Date.now();
      const timeSinceActivity = now - this.lastActivity;

      if (timeSinceActivity > this.timeout) {
        // Session expired, start a new one
        this.startNewSession();
      } else {
        // Update last activity
        this.lastActivity = now;
        this.persistSession();
      }
    };

    // Track various user interactions
    document.addEventListener("click", updateActivity, { passive: true });
    document.addEventListener("scroll", updateActivity, { passive: true });
    document.addEventListener("keydown", updateActivity, { passive: true });
    document.addEventListener("mousemove", this.throttle(updateActivity, 5000), {
      passive: true,
    });

    // Also update on visibility change (tab focus)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        updateActivity();
      }
    });

    this.activityListenersAttached = true;
  }

  /**
   * Throttle function to limit how often a function is called
   */
  private throttle<T extends (...args: unknown[]) => void>(
    func: T,
    limit: number
  ): T {
    let inThrottle = false;
    return ((...args: unknown[]) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    }) as T;
  }

  /**
   * Gets the current session ID
   */
  getSessionId(): string {
    if (!this.sessionId) {
      this.startNewSession();
    }
    return this.sessionId!;
  }

  /**
   * Gets the visitor ID
   */
  getVisitorId(): string {
    return this.visitorId;
  }

  /**
   * Gets the user identifier (if set)
   */
  getUserIdentifier(): string | null {
    return this.userIdentifier;
  }

  /**
   * Gets user traits (if set)
   */
  getUserTraits(): Record<string, unknown> {
    return this.userTraits;
  }

  /**
   * Identifies the current user
   */
  identify(userId: string, traits?: Record<string, unknown>): void {
    this.userIdentifier = userId;
    if (traits) {
      this.userTraits = { ...this.userTraits, ...traits };
    }
    this.log("Identified user:", userId, traits);
  }

  /**
   * Clears the user identification
   */
  clearIdentity(): void {
    this.userIdentifier = null;
    this.userTraits = {};
    this.log("Cleared user identity");
  }

  /**
   * Checks if this is the first batch for the current session
   * (meaning we need to send session metadata)
   */
  isFirstBatchForSession(): boolean {
    return this.isFirstBatch;
  }

  /**
   * Marks that the first batch has been sent
   */
  markFirstBatchSent(): void {
    this.isFirstBatch = false;
  }

  /**
   * Gets session metadata for the first batch
   */
  getSessionMetadata(): SessionMetadata {
    if (typeof window === "undefined") {
      return {
        userAgent: "",
        screenWidth: 0,
        screenHeight: 0,
        viewportWidth: 0,
        viewportHeight: 0,
        language: "en",
      };
    }

    return {
      userAgent: navigator.userAgent,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      language: navigator.language,
      referrer: document.referrer || undefined,
      utmParams: extractUtmParams(),
    };
  }

  /**
   * Updates the last activity timestamp
   */
  touch(): void {
    this.lastActivity = Date.now();
    this.persistSession();
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[Echoes:SessionManager]", ...args);
    }
  }
}
