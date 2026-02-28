import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo, type ReactNode } from "react";
import {
  ExperimentClient,
  type ExperimentClientOptions,
  type Variation,
  type ActiveExperiments,
} from "../experiments";

/**
 * Experiment context value
 */
interface ExperimentContextValue {
  client: ExperimentClient | null;
  isReady: boolean;
}

const ExperimentContext = createContext<ExperimentContextValue>({
  client: null,
  isReady: false,
});

/**
 * Props for ExperimentProvider
 */
export interface ExperimentProviderProps {
  /**
   * Experiment client options or pre-configured client
   */
  config: ExperimentClientOptions | ExperimentClient;
  children: ReactNode;
}

/**
 * Provider component for Experiments context
 *
 * @example
 * ```tsx
 * import { ExperimentProvider } from "@echoessh/sdk/react";
 *
 * function App() {
 *   return (
 *     <ExperimentProvider config={{ apiKey: "ek_live_xxx" }}>
 *       <YourApp />
 *     </ExperimentProvider>
 *   );
 * }
 * ```
 */
export function ExperimentProvider({
  config,
  children,
}: ExperimentProviderProps) {
  const client = useMemo(() => {
    if (config instanceof ExperimentClient) {
      return config;
    }
    return new ExperimentClient(config);
  }, [config]);

  return (
    <ExperimentContext.Provider value={{ client, isReady: true }}>
      {children}
    </ExperimentContext.Provider>
  );
}

/**
 * Hook to access the Experiment client directly
 */
export function useExperimentClient(): ExperimentClient | null {
  const context = useContext(ExperimentContext);
  return context.client;
}

/**
 * Result from useExperiment hook
 */
export interface UseExperimentResult {
  /** The assigned variation, or null if not assigned */
  variation: Variation | null;
  /** Whether the assignment is loading */
  isLoading: boolean;
  /** Error if assignment failed */
  error: Error | null;
  /** Track a conversion event */
  track: (eventName: string, eventValue?: number, properties?: Record<string, unknown>) => Promise<void>;
  /** Refresh the assignment */
  refresh: () => Promise<void>;
}

/**
 * Hook to get experiment variation and track conversions
 *
 * @example
 * ```tsx
 * import { useExperiment } from "@echoessh/sdk/react";
 *
 * function CheckoutPage() {
 *   const { variation, isLoading, track } = useExperiment("checkout-flow");
 *
 *   if (isLoading) return <Loading />;
 *
 *   const handlePurchase = async () => {
 *     // Track conversion
 *     await track("purchase", 99.99);
 *   };
 *
 *   if (variation?.key === "new-checkout") {
 *     return <NewCheckoutFlow onPurchase={handlePurchase} />;
 *   }
 *
 *   return <OldCheckoutFlow onPurchase={handlePurchase} />;
 * }
 * ```
 */
export function useExperiment(experimentKey: string): UseExperimentResult {
  const context = useContext(ExperimentContext);
  const [variation, setVariation] = useState<Variation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const fetchedRef = useRef(false);

  const fetchVariation = useCallback(async () => {
    if (!context.client) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const result = await context.client.getVariation(experimentKey);
      setVariation(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setVariation(null);
    } finally {
      setIsLoading(false);
    }
  }, [context.client, experimentKey]);

  // Fetch variation on mount
  useEffect(() => {
    if (context.isReady && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchVariation();
    }
  }, [context.isReady, fetchVariation]);

  const track = useCallback(
    async (
      eventName: string,
      eventValue?: number,
      properties?: Record<string, unknown>
    ) => {
      if (!context.client) return;
      await context.client.track(experimentKey, eventName, eventValue, properties);
    },
    [context.client, experimentKey]
  );

  const refresh = useCallback(async () => {
    fetchedRef.current = false;
    await fetchVariation();
  }, [fetchVariation]);

  return {
    variation,
    isLoading,
    error,
    track,
    refresh,
  };
}

/**
 * Hook to check if user is in a specific variation
 *
 * @example
 * ```tsx
 * import { useVariation } from "@echoessh/sdk/react";
 *
 * function Feature() {
 *   const isNewDesign = useVariation("homepage", "new-design");
 *
 *   if (isNewDesign) {
 *     return <NewDesign />;
 *   }
 *
 *   return <OldDesign />;
 * }
 * ```
 */
export function useVariation(
  experimentKey: string,
  variationKey: string
): boolean {
  const { variation, isLoading } = useExperiment(experimentKey);

  if (isLoading) return false;
  return variation?.key === variationKey;
}

/**
 * Hook to get feature flag value from variation configuration
 *
 * @example
 * ```tsx
 * import { useFeatureFlag } from "@echoessh/sdk/react";
 *
 * function Button() {
 *   const buttonColor = useFeatureFlag("button-experiment", "buttonColor", "blue");
 *
 *   return <button style={{ backgroundColor: buttonColor }}>Click me</button>;
 * }
 * ```
 */
export function useFeatureFlag<T>(
  experimentKey: string,
  flagKey: string,
  defaultValue: T
): T {
  const { variation, isLoading } = useExperiment(experimentKey);

  if (isLoading || !variation?.configuration) {
    return defaultValue;
  }

  const value = variation.configuration[flagKey];
  if (value === undefined) {
    return defaultValue;
  }

  return value as T;
}

/**
 * Hook to get all active experiment assignments
 *
 * @example
 * ```tsx
 * import { useActiveExperiments } from "@echoessh/sdk/react";
 *
 * function DebugPanel() {
 *   const experiments = useActiveExperiments();
 *
 *   return (
 *     <pre>{JSON.stringify(experiments, null, 2)}</pre>
 *   );
 * }
 * ```
 */
export function useActiveExperiments(): ActiveExperiments {
  const context = useContext(ExperimentContext);

  if (!context.client) {
    return {};
  }

  return context.client.getActiveExperiments();
}

/**
 * Hook to identify user in experiments
 *
 * @example
 * ```tsx
 * import { useExperimentIdentify } from "@echoessh/sdk/react";
 *
 * function LoginSuccess({ userId }) {
 *   const identify = useExperimentIdentify();
 *
 *   useEffect(() => {
 *     identify(userId);
 *   }, [userId]);
 *
 *   return <div>Welcome!</div>;
 * }
 * ```
 */
export function useExperimentIdentify(): (userIdentifier: string) => void {
  const context = useContext(ExperimentContext);

  return useCallback(
    (userIdentifier: string) => {
      if (context.client) {
        context.client.identify(userIdentifier);
      }
    },
    [context.client]
  );
}
