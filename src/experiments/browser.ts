/**
 * Browser entry point for CDN distribution
 * This file is built as an IIFE and exposes EchoesExperiments on the window object
 *
 * @example
 * ```html
 * <script src="https://unpkg.com/@echoessh/sdk/dist/experiments.min.js"></script>
 * <script>
 *   const client = EchoesExperiments.init({ apiKey: 'ek_live_xxx' });
 *   const variation = await client.getVariation('my-experiment');
 *   // or, locally once the config is cached:
 *   await client.loadConfig();
 *   const local = client.evaluate('my-experiment');
 * </script>
 * ```
 */

import { ExperimentClient, createExperimentClient } from "./index";
import type { ExperimentClientOptions } from "./types";

/**
 * Initialize the experiment client
 */
export function init(options: ExperimentClientOptions): ExperimentClient {
  return createExperimentClient(options);
}

/**
 * Create client (alias for init)
 */
export function createClient(options: ExperimentClientOptions): ExperimentClient {
  return createExperimentClient(options);
}

/**
 * ExperimentClient class for advanced usage
 */
export { ExperimentClient };

/**
 * Bucketing functions (the contract's rule), for local evaluation
 */
export {
  murmur3,
  hashToBucket,
  bucket10k,
  variationBucket,
  pickVariation,
  evaluateExperiment,
} from "./index";

/**
 * Version
 */
export const version = "1.2.0";
