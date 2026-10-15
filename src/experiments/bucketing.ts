/**
 * Deterministic assignment, as defined in the Echoes contract
 * (echoes-v2 docs/ratings-and-experiments.md, "Assignment: the bucketing rule").
 *
 * The server (echoes-v2 convex/lib/bucketing.ts) runs the same rule, and both
 * are tested against the shared vectors in test/fixtures/bucketing-vectors.json.
 *
 * Pure functions only: no network, no storage, no `window`. Safe in Node,
 * edge and Convex runtimes.
 */
import { murmur3 } from "./murmur3";
import type { ExperimentConfig, Variation, VariationConfig } from "./types";

/** Number of buckets used by the 1.2 rule (0–9999). */
export const BUCKET_COUNT = 10000;

function unitSuffix(experimentKey: string, unitId: string, salt?: string): string {
  return `${experimentKey}:${unitId}${salt ? `:${salt}` : ""}`;
}

/**
 * Traffic bucket of a unit for an experiment, from 0 to 9999.
 *
 * `murmur3_32(experimentKey + ":" + unitId + (salt ? ":" + salt : ""), seed 0) mod 10000`
 *
 * A unit enters the experiment when `bucket < trafficAllocation * 100`.
 * (The 1.0 function `hashToBucket` hashes the same string mod 100.)
 */
export function bucket10k(
  experimentKey: string,
  unitId: string,
  salt?: string
): number {
  return murmur3(unitSuffix(experimentKey, unitId, salt), 0) % BUCKET_COUNT;
}

/**
 * Variation pick of a unit for an experiment, from 0 to 9999.
 *
 * `murmur3_32("variation:" + experimentKey + ":" + unitId + (salt ? ":" + salt : ""), seed 0) mod 10000`
 *
 * A second, independent hash, so that changing the traffic doesn't move
 * units between variations.
 */
export function variationBucket(
  experimentKey: string,
  unitId: string,
  salt?: string
): number {
  return (
    murmur3(`variation:${unitSuffix(experimentKey, unitId, salt)}`, 0) %
    BUCKET_COUNT
  );
}

/**
 * Walk the variations in their stored order, adding each one's
 * `weight / Σweights × 10000`; the first whose running sum exceeds `pick`
 * is chosen. A zero (or negative) weight is never picked. Returns null when
 * no variation has a positive weight.
 *
 * The comparison `cumulative / total × 10000 > pick` is done exactly, as
 * `cumulative × 10000 > pick × total`, so that no floating-point rounding
 * can move a unit across a boundary.
 */
export function pickVariation<V extends Pick<VariationConfig, "weight">>(
  variations: readonly V[],
  pick: number
): V | null {
  let total = 0;
  for (const v of variations) {
    if (v.weight > 0) total += v.weight;
  }
  if (total <= 0) return null;

  let cumulative = 0;
  for (const v of variations) {
    if (!(v.weight > 0)) continue;
    cumulative += v.weight;
    if (cumulative * BUCKET_COUNT > pick * total) return v;
  }
  // Unreachable for 0 <= pick < 10000; kept as a guard for odd inputs.
  return null;
}

/**
 * Detailed result of a local evaluation.
 */
export interface EvaluationDetail {
  /** Traffic bucket, 0–9999 */
  bucket: number;
  /** Variation pick, 0–9999 */
  pick: number;
  /** Whether the unit falls inside the experiment's traffic */
  inTraffic: boolean;
  /** The chosen variation, or null when outside the traffic */
  variation: Variation | null;
}

/**
 * Evaluate one experiment configuration for one unit, with the contract's rule.
 * `targeting` is not evaluated: the contract serves it as `null` (everyone).
 */
export function evaluateExperimentDetailed(
  config: Pick<ExperimentConfig, "key" | "trafficAllocation" | "variations"> & {
    salt?: string | null;
  },
  unitId: string
): EvaluationDetail {
  const salt = config.salt ?? undefined;
  const bucket = bucket10k(config.key, unitId, salt);
  const pick = variationBucket(config.key, unitId, salt);
  const inTraffic = bucket < config.trafficAllocation * 100;
  const chosen = inTraffic ? pickVariation(config.variations, pick) : null;
  return {
    bucket,
    pick,
    inTraffic,
    variation: chosen
      ? {
          key: chosen.key,
          name: chosen.name,
          configuration: chosen.configuration ?? null,
        }
      : null,
  };
}

/**
 * Evaluate one experiment configuration for one unit. Returns the variation
 * (key, name, configuration), or null when the unit is outside the traffic.
 */
export function evaluateExperiment(
  config: Pick<ExperimentConfig, "key" | "trafficAllocation" | "variations"> & {
    salt?: string | null;
  },
  unitId: string
): Variation | null {
  return evaluateExperimentDetailed(config, unitId).variation;
}
