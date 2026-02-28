import {
  Variation,
  AssignmentResult,
  TrackResult,
  ConfigResponse,
  ExperimentConfig,
  AssignmentContext,
  ExperimentClientOptions,
  ExperimentStorage,
  CachedAssignment,
  ActiveExperiments,
} from "./types";
import { generateVisitorId, hashToBucket } from "./murmur3";

export * from "./types";
export * from "./murmur3";

const DEFAULT_BASE_URL = "https://echoes.sh";
const DEFAULT_TIMEOUT = 10000;
const STORAGE_KEY_PREFIX = "echoes_exp_";
const VISITOR_ID_KEY = "echoes_visitor_id";

/**
 * Default localStorage-based storage implementation
 */
const defaultStorage: ExperimentStorage = {
  get(key: string): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage might be full or blocked
    }
  },
  remove(key: string): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore errors
    }
  },
};

/**
 * Echoes Experiment Client for A/B testing
 *
 * @example
 * ```typescript
 * import { ExperimentClient } from "@echoessh/sdk/experiments";
 *
 * const experiments = new ExperimentClient({
 *   apiKey: "ek_live_xxxxxxxxxxxxx",
 * });
 *
 * // Get variation for an experiment
 * const variation = await experiments.getVariation("checkout-flow");
 * if (variation?.key === "new-checkout") {
 *   // Show new checkout flow
 * }
 *
 * // Track conversion
 * await experiments.track("checkout-flow", "purchase", 99.99);
 * ```
 */
export class ExperimentClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private debug: boolean;
  private visitorId: string;
  private userIdentifier: string | undefined;
  private storage: ExperimentStorage;
  private activeExperiments: ActiveExperiments = {};
  private configCache: ExperimentConfig[] | null = null;
  private configCacheTime: number = 0;
  private readonly CONFIG_CACHE_TTL = 60000; // 1 minute

  constructor(options: ExperimentClientOptions) {
    if (!options.apiKey) {
      throw new Error("API key is required");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE_URL;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.debug = options.debug ?? false;
    this.storage = defaultStorage;

    // Initialize visitor ID
    this.visitorId = options.visitorId || this.getOrCreateVisitorId();
    this.userIdentifier = options.userIdentifier;

    // Load cached assignments
    this.loadCachedAssignments();

    this.log("Experiment client initialized", { visitorId: this.visitorId });
  }

  /**
   * Get or create a persistent visitor ID
   */
  private getOrCreateVisitorId(): string {
    const stored = this.storage.get(VISITOR_ID_KEY);
    if (stored) {
      return stored;
    }

    const newId = generateVisitorId();
    this.storage.set(VISITOR_ID_KEY, newId);
    return newId;
  }

  /**
   * Load cached assignments from storage
   */
  private loadCachedAssignments(): void {
    const cached = this.storage.get(`${STORAGE_KEY_PREFIX}assignments`);
    if (cached) {
      try {
        this.activeExperiments = JSON.parse(cached);
      } catch {
        this.activeExperiments = {};
      }
    }
  }

  /**
   * Save assignments to storage
   */
  private saveCachedAssignments(): void {
    this.storage.set(
      `${STORAGE_KEY_PREFIX}assignments`,
      JSON.stringify(this.activeExperiments)
    );
  }

  /**
   * Get browser context for targeting
   */
  private getContext(): AssignmentContext {
    if (typeof navigator === "undefined") {
      return {};
    }

    const ua = navigator.userAgent;
    let deviceType: "desktop" | "mobile" | "tablet" = "desktop";
    if (/mobile/i.test(ua)) deviceType = "mobile";
    else if (/tablet|ipad/i.test(ua)) deviceType = "tablet";

    return {
      deviceType,
      userAgent: ua,
      language: navigator.language,
    };
  }

  /**
   * Get variation for an experiment
   * Returns cached variation if available, otherwise fetches from API
   */
  async getVariation(experimentKey: string): Promise<Variation | null> {
    // Check cache first
    const cached = this.activeExperiments[experimentKey];
    if (cached) {
      this.log(`Using cached assignment for ${experimentKey}:`, cached);

      // Get full variation config from config cache
      await this.refreshConfigIfNeeded();
      const config = this.configCache?.find((c) => c.key === experimentKey);
      const variation = config?.variations.find(
        (v) => v.key === cached.variationKey
      );

      if (variation) {
        return {
          key: variation.key,
          name: variation.name,
          configuration: variation.configuration,
        };
      }
    }

    // Fetch assignment from API
    const result = await this.assign(experimentKey);

    if (result.assigned && result.variation) {
      return result.variation;
    }

    return null;
  }

  /**
   * Request assignment for an experiment from the API
   */
  async assign(experimentKey: string): Promise<AssignmentResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/v1/sdk/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify({
          experimentKey,
          visitorId: this.visitorId,
          userIdentifier: this.userIdentifier,
          context: this.getContext(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        this.log(`Assignment failed for ${experimentKey}:`, data);
        return {
          success: false,
          assigned: false,
          variation: null,
          bucketValue: null,
          isNewAssignment: false,
        };
      }

      // Cache the assignment
      if (data.assigned && data.variation) {
        this.activeExperiments[experimentKey] = {
          variationKey: data.variation.key,
          assignmentId: data.assignmentId,
        };
        this.saveCachedAssignments();
      }

      this.log(`Assignment for ${experimentKey}:`, data);

      return data as AssignmentResult;
    } catch (error) {
      this.log(`Assignment error for ${experimentKey}:`, error);
      return {
        success: false,
        assigned: false,
        variation: null,
        bucketValue: null,
        isNewAssignment: false,
      };
    }
  }

  /**
   * Track a conversion event for an experiment
   */
  async track(
    experimentKey: string,
    eventName: string,
    eventValue?: number,
    properties?: Record<string, unknown>
  ): Promise<TrackResult> {
    // Check if user is assigned to this experiment
    const assignment = this.activeExperiments[experimentKey];
    if (!assignment) {
      this.log(`No assignment found for ${experimentKey}, skipping track`);
      return { success: false, error: "Not assigned to experiment" };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/v1/sdk/track`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify({
          experimentKey,
          visitorId: this.visitorId,
          eventName,
          eventValue,
          properties,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      this.log(`Track ${eventName} for ${experimentKey}:`, data);

      return data as TrackResult;
    } catch (error) {
      this.log(`Track error for ${experimentKey}:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Identify user (update user identifier for future requests)
   */
  identify(userIdentifier: string): void {
    this.userIdentifier = userIdentifier;
    this.log("User identified:", userIdentifier);
  }

  /**
   * Get all active experiment assignments
   */
  getActiveExperiments(): ActiveExperiments {
    return { ...this.activeExperiments };
  }

  /**
   * Refresh config cache if needed
   */
  private async refreshConfigIfNeeded(): Promise<void> {
    const now = Date.now();
    if (this.configCache && now - this.configCacheTime < this.CONFIG_CACHE_TTL) {
      return;
    }

    try {
      const config = await this.fetchConfig();
      if (config.success) {
        this.configCache = config.experiments;
        this.configCacheTime = now;
      }
    } catch {
      // Ignore errors, use existing cache
    }
  }

  /**
   * Fetch experiment configurations from the API
   */
  async fetchConfig(): Promise<ConfigResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/v1/sdk/config`, {
        method: "GET",
        headers: {
          "x-api-key": this.apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      this.log("Config fetched:", data);

      return data as ConfigResponse;
    } catch (error) {
      this.log("Config fetch error:", error);
      return { success: false, experiments: [] };
    }
  }

  /**
   * Get the current visitor ID
   */
  getVisitorId(): string {
    return this.visitorId;
  }

  /**
   * Reset all stored data (useful for testing)
   */
  reset(): void {
    this.activeExperiments = {};
    this.configCache = null;
    this.storage.remove(`${STORAGE_KEY_PREFIX}assignments`);
    this.storage.remove(VISITOR_ID_KEY);
    this.visitorId = generateVisitorId();
    this.storage.set(VISITOR_ID_KEY, this.visitorId);
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[Echoes Experiments]", ...args);
    }
  }
}

/**
 * Create an ExperimentClient instance
 */
export function createExperimentClient(
  options: ExperimentClientOptions
): ExperimentClient {
  return new ExperimentClient(options);
}
