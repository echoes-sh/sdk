"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { SessionManager } from "../analytics/session-manager";
import { EventBatcher } from "../analytics/event-batcher";
import { RecordingManager } from "../analytics/recording-manager";
import {
  ClickTracker,
  ScrollTracker,
  ErrorTracker,
  PageViewTracker,
  VisibilityTracker,
} from "../analytics/trackers";
import type { AnalyticsConfig, AnalyticsContextValue } from "../analytics/types";

// ============================================================================
// CONTEXT
// ============================================================================

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

// ============================================================================
// PROVIDER PROPS
// ============================================================================

export interface EchoesAnalyticsProviderProps {
  /**
   * Analytics configuration
   */
  config: AnalyticsConfig;
  /**
   * Children to render
   */
  children: ReactNode;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: Partial<AnalyticsConfig> = {
  baseUrl: "https://echoes.sh",
  trackPageViews: true,
  trackClicks: true,
  trackScroll: true,
  trackErrors: true,
  enableRecording: true,
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  batchSize: 10,
  batchInterval: 5000, // 5 seconds
  maskInputs: true,
  maskAllText: false,
  maxRecordingDuration: 30, // 30 minutes default
  // Rage-click detection defaults
  detectRageClicks: true,
  rageClickThreshold: 3,
  rageClickWindow: 1000,
  rageClickRadius: 50,
  debug: false,
};

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

/**
 * Provider component for Echoes Analytics
 *
 * @example
 * ```tsx
 * import { EchoesAnalyticsProvider } from "@echoessh/sdk/react";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <EchoesAnalyticsProvider
 *           config={{
 *             apiKey: "ek_live_xxx",
 *             trackPageViews: true,
 *             trackClicks: true,
 *             trackScroll: true,
 *             trackErrors: true,
 *           }}
 *         >
 *           {children}
 *         </EchoesAnalyticsProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function EchoesAnalyticsProvider({
  config: userConfig,
  children,
}: EchoesAnalyticsProviderProps) {
  // Merge config with defaults
  const config = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...userConfig }) as Required<AnalyticsConfig>,
    [userConfig]
  );

  // Refs for managers and trackers
  const sessionManagerRef = useRef<SessionManager | null>(null);
  const eventBatcherRef = useRef<EventBatcher | null>(null);
  const recordingManagerRef = useRef<RecordingManager | null>(null);
  const trackersRef = useRef<{
    click?: ClickTracker;
    scroll?: ScrollTracker;
    error?: ErrorTracker;
    pageView?: PageViewTracker;
    visibility?: VisibilityTracker;
  }>({});
  const initializedRef = useRef<boolean>(false);

  // Initialize on mount
  useEffect(() => {
    // Skip if already initialized or running on server
    if (initializedRef.current || typeof window === "undefined") return;
    initializedRef.current = true;

    // Debug logging
    const log = (...args: unknown[]) => {
      if (config.debug) {
        console.log("[Echoes:Analytics]", ...args);
      }
    };

    log("Initializing analytics with config:", config);

    // Create session manager
    const sessionManager = new SessionManager({
      timeout: config.sessionTimeout,
      onSessionStart: config.onSessionStart,
      debug: config.debug,
    });
    sessionManagerRef.current = sessionManager;

    // Create event batcher
    const eventBatcher = new EventBatcher({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      batchSize: config.batchSize,
      batchInterval: config.batchInterval,
      sessionManager,
      debug: config.debug,
      onError: config.onError,
    });
    eventBatcherRef.current = eventBatcher;

    // Create trackers based on config
    const trackerConfig = {
      batcher: eventBatcher,
      debug: config.debug,
    };

    if (config.trackClicks) {
      trackersRef.current.click = new ClickTracker({
        ...trackerConfig,
        ignoredElements: config.ignoredElements,
        detectRageClicks: config.detectRageClicks,
        rageClickThreshold: config.rageClickThreshold,
        rageClickWindow: config.rageClickWindow,
        rageClickRadius: config.rageClickRadius,
      });
      log("Click tracking enabled", config.detectRageClicks ? "(with rage-click detection)" : "");
    }

    if (config.trackScroll) {
      trackersRef.current.scroll = new ScrollTracker(trackerConfig);
      log("Scroll tracking enabled");
    }

    if (config.trackErrors) {
      trackersRef.current.error = new ErrorTracker(trackerConfig);
      log("Error tracking enabled");
    }

    if (config.trackPageViews) {
      trackersRef.current.pageView = new PageViewTracker({
        ...trackerConfig,
        onPageChange: (url) => {
          // Reset scroll tracker on page change
          trackersRef.current.scroll?.reset();
          log("Page changed:", url);
        },
      });
      log("Page view tracking enabled");
    }

    // Always track visibility
    trackersRef.current.visibility = new VisibilityTracker(trackerConfig);

    // Create recording manager if enabled
    if (config.enableRecording) {
      const recordingManager = new RecordingManager({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        sessionManager,
        maxDurationMinutes: config.maxRecordingDuration ?? 30,
        maskInputs: config.maskInputs,
        maskAllText: config.maskAllText,
        maskedElements: config.maskedElements,
        ignoredElements: config.ignoredElements,
        debug: config.debug,
        onError: config.onError,
      });
      recordingManagerRef.current = recordingManager;

      // Auto-start recording
      recordingManager.start();
      log("Recording manager initialized and started");
    }

    log("Analytics initialized successfully");

    // Cleanup on unmount
    return () => {
      log("Destroying analytics");

      // Destroy recording manager first (will flush remaining chunks)
      recordingManagerRef.current?.destroy();

      // Destroy all trackers
      trackersRef.current.click?.destroy();
      trackersRef.current.scroll?.destroy();
      trackersRef.current.error?.destroy();
      trackersRef.current.pageView?.destroy();
      trackersRef.current.visibility?.destroy();

      // Destroy batcher (will flush remaining events)
      eventBatcherRef.current?.destroy();

      initializedRef.current = false;
    };
  }, [config]);

  // Track custom event
  const track = useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      if (!eventBatcherRef.current) return;

      eventBatcherRef.current.add({
        type: "custom",
        name: eventName,
        properties,
        timestamp: Date.now(),
        url: typeof window !== "undefined" ? window.location.href : "",
      });

      if (config.debug) {
        console.log("[Echoes:Analytics] Custom event tracked:", eventName, properties);
      }
    },
    [config.debug]
  );

  // Identify user
  const identify = useCallback(
    (userId: string, traits?: Record<string, unknown>) => {
      sessionManagerRef.current?.identify(userId, traits);

      if (config.debug) {
        console.log("[Echoes:Analytics] User identified:", userId, traits);
      }
    },
    [config.debug]
  );

  // Get session ID
  const getSessionId = useCallback(() => {
    return sessionManagerRef.current?.getSessionId() ?? null;
  }, []);

  // Get visitor ID
  const getVisitorId = useCallback(() => {
    return sessionManagerRef.current?.getVisitorId() ?? null;
  }, []);

  // Check if recording is active
  const isRecording = useCallback(() => {
    return recordingManagerRef.current?.getIsRecording() ?? false;
  }, []);

  // Start recording
  const startRecording = useCallback(() => {
    if (!config.enableRecording) {
      console.warn("[Echoes:Analytics] Recording is not enabled in config");
      return;
    }

    if (!recordingManagerRef.current) {
      // Create recording manager on demand if not initialized
      if (sessionManagerRef.current) {
        const recordingManager = new RecordingManager({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          sessionManager: sessionManagerRef.current,
          maxDurationMinutes: config.maxRecordingDuration ?? 30,
          maskInputs: config.maskInputs,
          maskAllText: config.maskAllText,
          maskedElements: config.maskedElements,
          ignoredElements: config.ignoredElements,
          debug: config.debug,
          onError: config.onError,
        });
        recordingManagerRef.current = recordingManager;
      }
    }

    recordingManagerRef.current?.start();

    if (config.debug) {
      console.log("[Echoes:Analytics] Recording started");
    }
  }, [config]);

  // Stop recording
  const stopRecording = useCallback(() => {
    recordingManagerRef.current?.stop();

    if (config.debug) {
      console.log("[Echoes:Analytics] Recording stopped");
    }
  }, [config.debug]);

  // Flush events
  const flush = useCallback(async () => {
    await eventBatcherRef.current?.flush();
  }, []);

  // Context value
  const contextValue = useMemo<AnalyticsContextValue>(
    () => ({
      track,
      identify,
      getSessionId,
      getVisitorId,
      isRecording,
      startRecording,
      stopRecording,
      flush,
    }),
    [track, identify, getSessionId, getVisitorId, isRecording, startRecording, stopRecording, flush]
  );

  return (
    <AnalyticsContext.Provider value={contextValue}>
      {children}
    </AnalyticsContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to access Echoes Analytics functions
 *
 * @example
 * ```tsx
 * import { useEchoesAnalytics } from "@echoessh/sdk/react";
 *
 * function CheckoutButton() {
 *   const { track, identify } = useEchoesAnalytics();
 *
 *   const handlePurchase = async () => {
 *     track("purchase_completed", { value: 99.99, currency: "USD" });
 *   };
 *
 *   return <button onClick={handlePurchase}>Complete Purchase</button>;
 * }
 * ```
 */
export function useEchoesAnalytics(): AnalyticsContextValue {
  const context = useContext(AnalyticsContext);

  if (!context) {
    throw new Error(
      "useEchoesAnalytics must be used within an EchoesAnalyticsProvider"
    );
  }

  return context;
}

// ============================================================================
// OPTIONAL: NO-OP HOOK FOR SSR
// ============================================================================

/**
 * Safe version of useEchoesAnalytics that returns no-op functions
 * when used outside of EchoesAnalyticsProvider (useful for SSR)
 */
export function useEchoesAnalyticsSafe(): AnalyticsContextValue {
  const context = useContext(AnalyticsContext);

  if (!context) {
    return {
      track: () => {},
      identify: () => {},
      getSessionId: () => null,
      getVisitorId: () => null,
      isRecording: () => false,
      startRecording: () => {},
      stopRecording: () => {},
      flush: async () => {},
    };
  }

  return context;
}
