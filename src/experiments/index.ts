import {
  Variation,
  AssignmentResult,
  TrackResult,
  ConfigResponse,
  ExperimentConfig,
  AssignmentContext,
  ExperimentClientOptions,
  ExperimentStorage,
  ActiveExperiments,
  AssignOptions,
  TrackOptions,
} from "./types";
import { generateVisitorId } from "./murmur3";
import { evaluateExperiment } from "./bucketing";

export * from "./types";
export * from "./murmur3";
export * from "./bucketing";

const DEFAULT_BASE_URL = "https://echoes.sh";
const DEFAULT_TIMEOUT = 10000;
const STORAGE_KEY_PREFIX = "echoes_exp_";
const VISITOR_ID_KEY = "echoes_visitor_id";

/**
 * The runtime's localStorage, if it has a usable one. Node, edge and Convex
 * runtimes have none (and some throw on access), so every step is guarded.
 */
function browserLocalStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls || typeof ls.getItem !== "function") return null;
    // Probe: Safari private mode and sandboxed iframes can throw here.
    const probe = "__echoes_probe__";
    ls.setItem(probe, probe);
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * In-memory storage, used when the runtime has no localStorage or when
 * persistence is turned off.
 */
export function createMemoryStorage(): ExperimentStorage {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

function localStorageAdapter(ls: Storage): ExperimentStorage {
  return {
    get(key: string): string | null {
      try {
        return ls.getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      try {
        ls.setItem(key, value);
      } catch {
        // Storage might be full or blocked
      }
    },
    remove(key: string): void {
      try {
        ls.removeItem(key);
      } catch {
        // Ignore errors
      }
    },
  };
}

/** Wrap a storage so that a throwing get/set/remove never breaks the client. */
function safeStorage(storage: ExperimentStorage): ExperimentStorage {
  return {
    get(key) {
      try {
        return storage.get(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage.set(key, value);
      } catch {
        // Ignore: persistence is best effort
      }
    },
    remove(key) {
      try {
        storage.remove(key);
      } catch {
        // Ignore
      }
    },
  };
}

function resolveStorage(
  option: ExperimentClientOptions["storage"]
): ExperimentStorage {
  if (option) return safeStorage(option);
  if (option === null || option === false) return createMemoryStorage();
  const ls = browserLocalStorage();
  return ls ? localStorageAdapter(ls) : createMemoryStorage();
}

const NOT_ASSIGNED: AssignmentResult = {
  success: false,
  assigned: false,
  variation: null,
  bucketValue: null,
  isNewAssignment: false,
};

/**
 * Echoes Experiment Client for A/B testing
 *
 * @example
 * ```typescript
 * import { ExperimentClient } from "@echoessh/sdk";
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
    this.storage = resolveStorage(options.storage);

    if (options.initialConfig) {
      this.configCache = options.initialConfig;
      this.configCacheTime = Date.now();
    }

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
    // Only in a browser: Node 21+ has a `navigator` too, with nothing useful.
    if (typeof window === "undefined" || typeof navigator === "undefined") {
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
   * Request assignment for an experiment from the API. This is what records
   * exposure on the server; the stored assignment is returned on later calls.
   *
   * @param experimentKey - The experiment key
   * @param unitId - The unit to assign (a visitor id, a user id, a room id…).
   *   Defaults to the client's visitor id. Only assignments of the client's
   *   own visitor are remembered locally (getActiveExperiments, rate/send
   *   context); assigning other units, as server code does, leaves them alone.
   * @param options - Per-call user identifier or context
   */
  async assign(
    experimentKey: string,
    unitId?: string,
    options?: AssignOptions
  ): Promise<AssignmentResult> {
    const unit = unitId ?? this.visitorId;
    const isOwnVisitor = unit === this.visitorId;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/sdk/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify({
          experimentKey,
          // `visitorId` is the 1.0 name and stays required; 1.2 servers read
          // `unitId` first.
          visitorId: unit,
          unitId: unit,
          userIdentifier: options?.userIdentifier ?? this.userIdentifier,
          context: options?.context ?? this.getContext(),
        }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        this.log(`Assignment failed for ${experimentKey}:`, data);
        return { ...NOT_ASSIGNED };
      }

      // Cache the assignment of this client's own visitor
      if (isOwnVisitor && data.assigned && data.variation) {
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
      return { ...NOT_ASSIGNED };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Evaluate an experiment locally, from the cached config, with the
   * contract's bucketing rule (the same function the server runs).
   *
   * Synchronous and network-free: it returns null when the config isn't
   * cached yet (call `loadConfig()` first, or pass `initialConfig`), when the
   * experiment isn't running (not in the config), or when the unit is outside
   * the traffic. It records no exposure: use `assign` for that.
   *
   * @param experimentKey - The experiment key
   * @param unitId - The unit to evaluate. Defaults to the client's visitor id.
   */
  evaluate(experimentKey: string, unitId?: string): Variation | null {
    const config = this.configCache?.find((c) => c.key === experimentKey);
    if (!config) {
      this.log(`No cached config for ${experimentKey}`);
      return null;
    }
    return evaluateExperiment(config, unitId ?? this.visitorId);
  }

  /**
   * Make sure the config is cached (fetching it when missing or older than
   * 60 s, or always with `force`), and return it.
   */
  async loadConfig(force = false): Promise<ExperimentConfig[]> {
    if (force) {
      // A failed refetch keeps the cache we had.
      await this.fetchConfig();
    } else {
      await this.refreshConfigIfNeeded();
    }
    return this.configCache ?? [];
  }

  /**
   * Replace the cached config, e.g. with a copy you stored yourself.
   * It is treated as fresh for the cache's TTL.
   */
  setConfig(experiments: ExperimentConfig[]): void {
    this.configCache = experiments;
    this.configCacheTime = Date.now();
  }

  /**
   * The cached config, or null when none has been loaded.
   */
  getConfig(): ExperimentConfig[] | null {
    return this.configCache;
  }

  /**
   * Track a conversion event for an experiment
   */
  async track(
    experimentKey: string,
    eventName: string,
    eventValue?: number,
    properties?: Record<string, unknown>,
    options?: TrackOptions
  ): Promise<TrackResult> {
    const unit = options?.unitId ?? this.visitorId;

    // For the client's own visitor, check it is assigned to this experiment.
    // Other units (server code) are checked by the server.
    if (unit === this.visitorId && !this.activeExperiments[experimentKey]) {
      this.log(`No assignment found for ${experimentKey}, skipping track`);
      return { success: false, error: "Not assigned to experiment" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {

      const response = await fetch(`${this.baseUrl}/api/v1/sdk/track`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify({
          experimentKey,
          visitorId: unit,
          unitId: unit,
          eventName,
          eventValue,
          properties,
        }),
        signal: controller.signal,
      });

      const data = await response.json();

      this.log(`Track ${eventName} for ${experimentKey}:`, data);

      return data as TrackResult;
    } catch (error) {
      this.log(`Track error for ${experimentKey}:`, error);
      return { success: false, error: String(error) };
    } finally {
      clearTimeout(timeoutId);
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

    // fetchConfig never throws and caches a successful answer itself;
    // on failure the existing cache, if any, is kept.
    await this.fetchConfig();
  }

  /**
   * Fetch experiment configurations from the API (the running experiments).
   * A successful answer also replaces the cached config.
   */
  async fetchConfig(): Promise<ConfigResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/sdk/config`, {
        method: "GET",
        headers: {
          "x-api-key": this.apiKey,
        },
        signal: controller.signal,
      });

      const data = (await response.json()) as ConfigResponse;

      this.log("Config fetched:", data);

      if (response.ok && data.success && Array.isArray(data.experiments)) {
        this.configCache = data.experiments;
        this.configCacheTime = Date.now();
      }

      return data;
    } catch (error) {
      this.log("Config fetch error:", error);
      return { success: false, experiments: [] };
    } finally {
      clearTimeout(timeoutId);
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
