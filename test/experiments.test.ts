/**
 * ExperimentClient in a server-like runtime: Vitest's node environment has
 * no window, document or localStorage.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ExperimentClient,
  createMemoryStorage,
  type ConfigResponse,
  type ExperimentConfig,
  type ExperimentStorage,
} from "../src/experiments";
import { mockFetch } from "./helpers";

const API_KEY = "ek_test_abc123";
const BASE = "https://echoes.test";

const roomAgent: ExperimentConfig = {
  key: "room-agent",
  name: "Room agent model",
  kind: "experiment",
  trafficAllocation: 100,
  salt: "k3v9",
  targeting: null,
  variations: [
    { key: "sol", name: "gpt-6.1-sol", weight: 40, isControl: true, configuration: { model: "gpt-6.1-sol" } },
    { key: "astra", name: "Astra", weight: 20, isControl: false, configuration: { model: "astra" } },
    { key: "opus", name: "Opus 5.5", weight: 20, isControl: false, configuration: { model: "claude-opus-5-5" } },
    { key: "fable", name: "Fable", weight: 20, isControl: false, configuration: { model: "fable" } },
  ],
};

const assigned = (key = "opus", assignmentId = "a_1") => ({
  json: {
    success: true,
    assigned: true,
    variation: { key, name: key, configuration: null },
    bucketValue: 9821,
    isNewAssignment: true,
    assignmentId,
  },
});

const client = (extra: Partial<ConstructorParameters<typeof ExperimentClient>[0]> = {}) =>
  new ExperimentClient({ apiKey: API_KEY, baseUrl: BASE, visitorId: "visitor-1", ...extra });

describe("runtime without window/document/localStorage", () => {
  it("really is one", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof localStorage).toBe("undefined");
  });

  it("constructs, generates a visitor id and keeps it in memory", () => {
    const c = new ExperimentClient({ apiKey: API_KEY });
    expect(c.getVisitorId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.getActiveExperiments()).toEqual({});
    c.reset();
    expect(c.getVisitorId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends an empty context (no navigator sniffing outside a browser)", async () => {
    const { calls } = mockFetch(assigned());
    await client().assign("room-agent");
    expect((calls[0].body as { context: unknown }).context).toEqual({});
  });
});

describe("storage", () => {
  it("uses a custom storage when given one", async () => {
    const storage = createMemoryStorage();
    const set = vi.spyOn(storage, "set");
    mockFetch(assigned());
    const c = new ExperimentClient({ apiKey: API_KEY, baseUrl: BASE, storage });
    expect(storage.get("echoes_visitor_id")).toBe(c.getVisitorId());
    await c.assign("room-agent");
    expect(set).toHaveBeenCalledWith(
      "echoes_exp_assignments",
      JSON.stringify({ "room-agent": { variationKey: "opus", assignmentId: "a_1" } })
    );

    // A second client on the same storage picks the visitor and assignments up.
    const again = new ExperimentClient({ apiKey: API_KEY, storage });
    expect(again.getVisitorId()).toBe(c.getVisitorId());
    expect(again.getActiveExperiments()).toEqual(c.getActiveExperiments());
  });

  it("survives a storage that throws", () => {
    const broken: ExperimentStorage = {
      get: () => {
        throw new Error("blocked");
      },
      set: () => {
        throw new Error("blocked");
      },
      remove: () => {
        throw new Error("blocked");
      },
    };
    expect(() => new ExperimentClient({ apiKey: API_KEY, storage: broken })).not.toThrow();
    expect(new ExperimentClient({ apiKey: API_KEY, storage: broken }).getActiveExperiments()).toEqual({});
    expect(() => new ExperimentClient({ apiKey: API_KEY, storage: null })).not.toThrow();
    expect(() => new ExperimentClient({ apiKey: API_KEY, storage: false })).not.toThrow();
  });

  it("uses localStorage when the runtime has one", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
    const c = new ExperimentClient({ apiKey: API_KEY });
    expect(map.get("echoes_visitor_id")).toBe(c.getVisitorId());
  });

  it("falls back to memory when localStorage throws on access", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {},
    });
    expect(() => new ExperimentClient({ apiKey: API_KEY })).not.toThrow();
  });
});

describe("assign()", () => {
  it("posts visitorId and unitId (the client's visitor by default)", async () => {
    const { calls } = mockFetch(assigned());
    const result = await client({ userIdentifier: "u@x.y" }).assign("room-agent");
    expect(result).toMatchObject({ success: true, assigned: true, assignmentId: "a_1" });
    expect(calls[0].url).toBe(`${BASE}/api/v1/sdk/assign`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["x-api-key"]).toBe(API_KEY);
    expect(calls[0].body).toEqual({
      experimentKey: "room-agent",
      visitorId: "visitor-1",
      unitId: "visitor-1",
      userIdentifier: "u@x.y",
      context: {},
    });
  });

  it("assigns another unit (e.g. a room id from server code) without touching the visitor's experiments", async () => {
    const { calls } = mockFetch(assigned("sol", "a_room"));
    const c = client();
    const result = await c.assign("room-agent", "room:jd7x", {
      userIdentifier: "household-1",
      context: { source: "convex" },
    });
    expect(result.variation?.key).toBe("sol");
    expect(calls[0].body).toEqual({
      experimentKey: "room-agent",
      visitorId: "room:jd7x",
      unitId: "room:jd7x",
      userIdentifier: "household-1",
      context: { source: "convex" },
    });
    expect(c.getActiveExperiments()).toEqual({});
  });

  it("records the visitor's own assignment", async () => {
    mockFetch(assigned());
    const c = client();
    await c.assign("room-agent", "visitor-1");
    expect(c.getActiveExperiments()).toEqual({
      "room-agent": { variationKey: "opus", assignmentId: "a_1" },
    });
  });

  it("answers not-assigned on a 404 or a network error, without throwing", async () => {
    mockFetch({ status: 404, json: { success: false, error: "Experiment not found" } });
    await expect(client().assign("nope")).resolves.toMatchObject({ success: false, assigned: false, variation: null });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    await expect(client().assign("room-agent")).resolves.toMatchObject({ success: false, assigned: false });
  });

  it("passes a not-in-traffic answer through", async () => {
    const answer = { success: true, assigned: false, variation: null, bucketValue: 7000, isNewAssignment: false };
    mockFetch({ json: answer });
    const c = client();
    await expect(c.assign("room-agent")).resolves.toEqual(answer);
    expect(c.getActiveExperiments()).toEqual({});
  });
});

describe("track()", () => {
  it("posts visitorId and unitId for the visitor's assigned experiment", async () => {
    const { calls } = mockFetch(assigned(), { json: { success: true } });
    const c = client();
    await c.assign("room-agent");
    const result = await c.track("room-agent", "room_ready", 42.5, { attempt: 1 });
    expect(result).toEqual({ success: true });
    expect(calls[1].url).toBe(`${BASE}/api/v1/sdk/track`);
    expect(calls[1].body).toEqual({
      experimentKey: "room-agent",
      visitorId: "visitor-1",
      unitId: "visitor-1",
      eventName: "room_ready",
      eventValue: 42.5,
      properties: { attempt: 1 },
    });
  });

  it("skips the call when the visitor isn't assigned (as in 1.0)", async () => {
    const { fn } = mockFetch();
    await expect(client().track("room-agent", "room_ready")).resolves.toEqual({
      success: false,
      error: "Not assigned to experiment",
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("tracks another unit, leaving the check to the server", async () => {
    const { calls } = mockFetch({ status: 404, json: { success: false, error: "No assignment for this visitor" } });
    const result = await client().track("room-agent", "room_cost_usd", 0.42, undefined, { unitId: "room:jd7x" });
    expect(result).toEqual({ success: false, error: "No assignment for this visitor" });
    expect(calls[0].body).toEqual({
      experimentKey: "room-agent",
      visitorId: "room:jd7x",
      unitId: "room:jd7x",
      eventName: "room_cost_usd",
      eventValue: 0.42,
    });
  });
});

describe("config and evaluate()", () => {
  const configAnswer: ConfigResponse = { success: true, experiments: [roomAgent] };

  it("returns null before any config is cached, without a network call", () => {
    const { fn } = mockFetch();
    expect(client().evaluate("room-agent", "visitor-1")).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("loads the config once, then evaluates locally", async () => {
    const { calls } = mockFetch({ json: configAnswer });
    const c = client();
    expect(await c.loadConfig()).toEqual([roomAgent]);
    expect(await c.loadConfig()).toEqual([roomAgent]); // cached for 60 s
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: `${BASE}/api/v1/sdk/config`, method: "GET" });
    expect(calls[0].headers["x-api-key"]).toBe(API_KEY);

    expect(c.evaluate("room-agent", "k57a8b9c0d1e2f3")).toEqual({
      key: "opus",
      name: "Opus 5.5",
      configuration: { model: "claude-opus-5-5" },
    });
    expect(c.evaluate("room-agent", "visitor-1")?.key).toBe("sol");
    // Defaults to the client's visitor.
    expect(c.evaluate("room-agent")?.key).toBe("sol");
    // Not running → not in the config → null.
    expect(c.evaluate("paused-experiment", "visitor-1")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("refetches with force, and keeps the old cache when a refetch fails", async () => {
    const { calls } = mockFetch(
      { json: configAnswer },
      { json: { success: true, experiments: [] } },
      { status: 500, json: { success: false } }
    );
    const c = client();
    await c.loadConfig();
    expect(await c.loadConfig(true)).toEqual([]);
    c.setConfig([roomAgent]);
    expect(await c.loadConfig(true)).toEqual([roomAgent]);
    expect(calls).toHaveLength(3);

    const d = client({ initialConfig: [roomAgent] });
    mockFetch({ status: 500, json: { success: false } });
    expect(await d.fetchConfig()).toEqual({ success: false });
    expect(d.getConfig()).toEqual([roomAgent]);
  });

  it("evaluates from an initialConfig or setConfig, with no network at all", () => {
    const { fn } = mockFetch();
    const c = client({ initialConfig: [roomAgent], storage: null });
    expect(c.evaluate("room-agent", "visitor-2")?.key).toBe("astra");

    const d = client();
    d.setConfig([{ ...roomAgent, trafficAllocation: 0 }]);
    expect(d.evaluate("room-agent", "visitor-2")).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("treats a config without salt or kind (1.0 servers) as unsalted", () => {
    const { salt: _salt, kind: _kind, ...legacy } = roomAgent;
    const c = client({ initialConfig: [{ ...legacy, key: "new-checkout", trafficAllocation: 50, variations: [
      { key: "off", name: "off", weight: 1, isControl: true, configuration: null },
      { key: "on", name: "on", weight: 1, isControl: false, configuration: null },
    ] }] });
    // From the shared vectors: new-checkout, salt "", visitor-1 → off.
    expect(c.evaluate("new-checkout", "visitor-1")?.key).toBe("off");
  });

  it("getVariation uses the cached assignment's full variation from the config", async () => {
    const { calls } = mockFetch(assigned("opus"), { json: configAnswer });
    const c = client();
    await c.assign("room-agent");
    await expect(c.getVariation("room-agent")).resolves.toEqual({
      key: "opus",
      name: "Opus 5.5",
      configuration: { model: "claude-opus-5-5" },
    });
    expect(calls.map((x) => x.url)).toEqual([`${BASE}/api/v1/sdk/assign`, `${BASE}/api/v1/sdk/config`]);
  });
});
