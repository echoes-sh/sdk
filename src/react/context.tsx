import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { Echoes, type EchoesConfig } from "../index";

interface EchoesContextValue {
  client: Echoes;
}

const EchoesContext = createContext<EchoesContextValue | null>(null);

export interface EchoesProviderProps {
  /**
   * Echoes configuration or pre-configured client
   */
  config: EchoesConfig | Echoes;
  children: ReactNode;
}

/**
 * Provider component for Echoes context
 *
 * @example
 * ```tsx
 * import { EchoesProvider } from "@echoessh/sdk/react";
 *
 * function App() {
 *   return (
 *     <EchoesProvider config={{ apiKey: "ek_live_xxx" }}>
 *       <YourApp />
 *     </EchoesProvider>
 *   );
 * }
 * ```
 */
export function EchoesProvider({ config, children }: EchoesProviderProps) {
  const client = useMemo(() => {
    if (config instanceof Echoes) {
      return config;
    }
    return new Echoes(config);
  }, [config]);

  return (
    <EchoesContext.Provider value={{ client }}>
      {children}
    </EchoesContext.Provider>
  );
}

/**
 * Hook to access the Echoes client
 *
 * @example
 * ```tsx
 * import { useEchoes } from "@echoessh/sdk/react";
 *
 * function FeedbackButton() {
 *   const echoes = useEchoes();
 *
 *   const handleClick = async () => {
 *     await echoes.bug("Something went wrong");
 *   };
 *
 *   return <button onClick={handleClick}>Report Bug</button>;
 * }
 * ```
 */
export function useEchoes(): Echoes {
  const context = useContext(EchoesContext);

  if (!context) {
    throw new Error("useEchoes must be used within an EchoesProvider");
  }

  return context.client;
}
