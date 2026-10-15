/**
 * The bucketing rule of the Echoes contract.
 *
 * test/fixtures/bucketing-vectors.json is a verbatim copy of
 * echoes-v2 docs/bucketing-vectors.json (shared with the server's
 * convex/lib/bucketing.ts; contract: echoes-v2 docs/ratings-and-experiments.md).
 * Copied 2026-10-15, sha256 08c2bb5976dab3d0d53b0c123f5597eaccfd36fc13cc950dc3914fc3a5a9e23b.
 * Do not edit it here: change it in echoes-v2 and copy it again.
 */
import { describe, expect, it } from "vitest";
import vectors from "./fixtures/bucketing-vectors.json";
import {
  BUCKET_COUNT,
  ExperimentClient,
  bucket10k,
  evaluateExperiment,
  evaluateExperimentDetailed,
  hashToBucket,
  murmur3,
  pickVariation,
  variationBucket,
  type ExperimentConfig,
} from "../src/experiments";

type FixtureConfig = (typeof vectors.configs)[number];

/** A full ExperimentConfig (as /api/v1/sdk/config serves it) from a fixture config. */
function toExperimentConfig(c: FixtureConfig): ExperimentConfig {
  return {
    key: c.key,
    name: c.key,
    kind: "experiment",
    salt: c.salt,
    trafficAllocation: c.trafficAllocation,
    targeting: null,
    variations: c.variations.map((v, i) => ({
      key: v.key,
      name: `Variation ${v.key}`,
      weight: v.weight,
      isControl: i === 0,
      configuration: { variant: v.key },
    })),
  };
}

const configs = new Map(vectors.configs.map((c) => [c.key, toExperimentConfig(c)]));

describe("shared bucketing vectors", () => {
  it("has vectors for every config, non-ASCII ids included", () => {
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(24);
    for (const v of vectors.vectors) expect(configs.has(v.experimentKey)).toBe(true);
    expect(vectors.vectors.some((v) => /[^\x00-\x7f]/.test(v.unitId))).toBe(true);
  });

  describe.each(vectors.vectors)(
    "$experimentKey / $unitId",
    ({ experimentKey, salt, unitId, bucket, pick, variation }) => {
      it("bucket10k gives the traffic bucket", () => {
        expect(bucket10k(experimentKey, unitId, salt)).toBe(bucket);
      });

      it("variationBucket gives the pick", () => {
        expect(variationBucket(experimentKey, unitId, salt)).toBe(pick);
      });

      it("evaluateExperiment gives the variation", () => {
        const config = configs.get(experimentKey)!;
        expect(evaluateExperiment(config, unitId)?.key ?? null).toBe(variation);
      });

      it("ExperimentClient.evaluate gives the variation from the cached config", () => {
        const client = new ExperimentClient({
          apiKey: "ek_test_x",
          storage: null,
          initialConfig: [...configs.values()],
        });
        const result = client.evaluate(experimentKey, unitId);
        expect(result?.key ?? null).toBe(variation);
        if (variation !== null) {
          expect(result).toEqual({
            key: variation,
            name: `Variation ${variation}`,
            configuration: { variant: variation },
          });
        }
      });
    }
  );

  it("evaluateExperimentDetailed agrees with the vectors on traffic", () => {
    for (const v of vectors.vectors) {
      const config = configs.get(v.experimentKey)!;
      const detail = evaluateExperimentDetailed(config, v.unitId);
      expect(detail.bucket).toBe(v.bucket);
      expect(detail.pick).toBe(v.pick);
      expect(detail.inTraffic).toBe(v.bucket < config.trafficAllocation * 100);
      expect(detail.variation?.key ?? null).toBe(v.variation);
    }
  });
});

describe("bucket10k and variationBucket", () => {
  it("stay within 0–9999", () => {
    for (let i = 0; i < 2000; i++) {
      const b = bucket10k("exp", `unit-${i}`, "s");
      const p = variationBucket("exp", `unit-${i}`, "s");
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(BUCKET_COUNT);
      expect(Number.isInteger(b)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(BUCKET_COUNT);
    }
  });

  it("treat an empty salt as no salt", () => {
    expect(bucket10k("k", "u", "")).toBe(bucket10k("k", "u"));
    expect(variationBucket("k", "u", "")).toBe(variationBucket("k", "u"));
  });

  it("hash the strings the contract names", () => {
    expect(bucket10k("k", "u", "s")).toBe(murmur3("k:u:s", 0) % 10000);
    expect(variationBucket("k", "u", "s")).toBe(murmur3("variation:k:u:s", 0) % 10000);
  });
});

describe("hashToBucket (1.0) is unchanged", () => {
  it("keeps its 0–99 values", () => {
    expect(hashToBucket("checkout", "visitor-1")).toBe(70);
    expect(hashToBucket("room-agent", "visitor-1", "k3v9")).toBe(65);
    expect(hashToBucket("new-checkout", "élodie@example.fr", "")).toBe(50);
  });

  it("is the 10k bucket mod 100 (same hash input)", () => {
    for (const v of vectors.vectors) {
      expect(hashToBucket(v.experimentKey, v.unitId, v.salt)).toBe(v.bucket % 100);
    }
  });
});

describe("pickVariation", () => {
  const vs = (...weights: number[]) => weights.map((weight, i) => ({ key: `v${i}`, weight }));

  it("walks the weights in order with exact boundaries", () => {
    const variations = vs(1, 1); // 0–4999 → v0, 5000–9999 → v1
    expect(pickVariation(variations, 0)?.key).toBe("v0");
    expect(pickVariation(variations, 4999)?.key).toBe("v0");
    expect(pickVariation(variations, 5000)?.key).toBe("v1");
    expect(pickVariation(variations, 9999)?.key).toBe("v1");
  });

  it("does not need weights to sum to 100", () => {
    const variations = vs(40, 20, 20, 20); // 4000 / 2000 / 2000 / 2000
    expect(pickVariation(variations, 3999)?.key).toBe("v0");
    expect(pickVariation(variations, 4000)?.key).toBe("v1");
    expect(pickVariation(variations, 7999)?.key).toBe("v2");
    expect(pickVariation(variations, 8000)?.key).toBe("v3");
  });

  it("handles boundaries that fall between integers (weights 1/3 each)", () => {
    const variations = vs(1, 1, 1); // boundaries 3333.33… and 6666.66…
    expect(pickVariation(variations, 3333)?.key).toBe("v0");
    expect(pickVariation(variations, 3334)?.key).toBe("v1");
    expect(pickVariation(variations, 6666)?.key).toBe("v1");
    expect(pickVariation(variations, 6667)?.key).toBe("v2");
  });

  it("compares exactly where a float walk would round up (weights 14/86, pick 1400)", () => {
    // 14 / 100 * 10000 is 1400.0000000000002 in floating point, which would
    // wrongly put pick 1400 in the first variation. Exactly, 1400 > 1400 is false.
    expect(pickVariation(vs(14, 86), 1399)?.key).toBe("v0");
    expect(pickVariation(vs(14, 86), 1400)?.key).toBe("v1");
  });

  it("never picks a zero weight", () => {
    const variations = vs(0, 3, 0, 1, 0);
    for (let pick = 0; pick < BUCKET_COUNT; pick += 7) {
      const key = pickVariation(variations, pick)?.key;
      expect(key === "v1" || key === "v3").toBe(true);
    }
    expect(pickVariation(variations, 0)?.key).toBe("v1");
    expect(pickVariation(variations, 9999)?.key).toBe("v3");
  });

  it("returns null when no weight is positive", () => {
    expect(pickVariation(vs(0, 0), 10)).toBeNull();
    expect(pickVariation([], 10)).toBeNull();
  });

  it("spreads units by weight", () => {
    const config: ExperimentConfig = {
      key: "spread",
      name: "spread",
      salt: "x",
      trafficAllocation: 100,
      targeting: null,
      variations: [
        { key: "a", name: "a", weight: 3, isControl: true, configuration: null },
        { key: "b", name: "b", weight: 1, isControl: false, configuration: null },
      ],
    };
    const counts = { a: 0, b: 0 } as Record<string, number>;
    for (let i = 0; i < 20000; i++) counts[evaluateExperiment(config, `u${i}`)!.key]++;
    expect(counts.a / 20000).toBeGreaterThan(0.73);
    expect(counts.a / 20000).toBeLessThan(0.77);
  });
});

describe("traffic", () => {
  const base: ExperimentConfig = {
    key: "t",
    name: "t",
    salt: "s",
    trafficAllocation: 0,
    targeting: null,
    variations: [
      { key: "off", name: "off", weight: 1, isControl: true, configuration: null },
      { key: "on", name: "on", weight: 1, isControl: false, configuration: null },
    ],
  };

  it("0 % lets nobody in and 100 % everybody", () => {
    for (let i = 0; i < 500; i++) {
      expect(evaluateExperiment({ ...base, trafficAllocation: 0 }, `u${i}`)).toBeNull();
      expect(evaluateExperiment({ ...base, trafficAllocation: 100 }, `u${i}`)).not.toBeNull();
    }
  });

  it("raising the traffic doesn't move units already in between variations", () => {
    for (let i = 0; i < 2000; i++) {
      const before = evaluateExperiment({ ...base, trafficAllocation: 30 }, `u${i}`);
      const after = evaluateExperiment({ ...base, trafficAllocation: 80 }, `u${i}`);
      if (before) expect(after?.key).toBe(before.key);
    }
  });
});

describe("murmur3 stability", () => {
  it("matches published MurmurHash3 x86_32 values for ASCII", () => {
    expect(murmur3("")).toBe(0);
    expect(murmur3("a")).toBe(0x3c2569b2);
    expect(murmur3("abc")).toBe(0xb3dd93fa);
    expect(murmur3("hello")).toBe(0x248bfa47);
    expect(murmur3("The quick brown fox jumps over the lazy dog")).toBe(0x2e4ff723);
  });

  it("keeps its values for every tail length and a seed", () => {
    expect(murmur3("ab")).toBe(2613040991);
    expect(murmur3("abcd")).toBe(1139631978);
    expect(murmur3("room-agent:visitor-1:k3v9")).toBe(3694490365);
    expect(murmur3("", 42)).toBe(142593372);
    expect(murmur3("hello", 42)).toBe(3806057185);
  });

  it("reads each UTF-16 code unit's low byte (not UTF-8), as the contract says", () => {
    expect(murmur3("é")).toBe(1153881266);
    // U+0100 has low byte 0x00, so it hashes as "\0".
    expect(murmur3("Ā")).toBe(murmur3("\u0000"));
    // A UTF-8 implementation would hash "é" as two bytes; this one hashes one.
    expect(murmur3("é")).toBe(murmur3("é"));
    expect(murmur3("é")).not.toBe(murmur3("Ã©"));
  });

  it("returns unsigned 32-bit integers", () => {
    for (let i = 0; i < 1000; i++) {
      const h = murmur3(`key-${i}`);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("the variation walk on weight boundaries (exact, not floating point)", () => {
  for (const b of vectors.boundaries) {
    it(`weights ${b.weights.map((w) => w.weight).join("/")}, pick ${b.pick} → ${b.variation}`, () => {
      expect(pickVariation(b.weights, b.pick)?.key ?? null).toBe(b.variation);
    });
  }
});
