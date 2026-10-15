import { describe, expect, it, vi } from "vitest";
import { Echoes, EchoesError, ErrorCodes, ExperimentClient } from "../src";
import type { RateParams } from "../src";
import { hangingFetch, mockFetch } from "./helpers";

const API_KEY = "ek_test_abc123";
const BASE = "https://echoes.test";

const echoes = (extra: Partial<ConstructorParameters<typeof Echoes>[0]> = {}) =>
  new Echoes({ apiKey: API_KEY, baseUrl: `${BASE}/`, ...extra });

const room = { type: "room", id: "k57a8b9c0d1e2f3", version: "3" };

async function rejection(promise: Promise<unknown>): Promise<EchoesError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(EchoesError);
    return err as EchoesError;
  }
  throw new Error("expected a rejection");
}

describe("rate()", () => {
  it("posts the contract's shape to /api/v1/ratings and returns { ratingId, updated }", async () => {
    const { calls } = mockFetch({
      status: 201,
      json: { success: true, ratingId: "r_1", updated: false },
    });

    const result = await echoes().rate({
      subject: room,
      stars: 4,
      comment: "  Lovely, but the sofa faces the wall  ",
      userIdentifier: "salim@example.com",
      metadata: { page: "visit" },
      experiments: [{ key: "room-agent", unitId: room.id }],
    });

    expect(result).toEqual({ ratingId: "r_1", updated: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/v1/ratings`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["x-api-key"]).toBe(API_KEY);
    expect(calls[0].headers["content-type"]).toBe("application/json");
    expect(calls[0].body).toEqual({
      subject: { type: "room", id: room.id, version: "3" },
      stars: 4,
      comment: "Lovely, but the sofa faces the wall",
      userIdentifier: "salim@example.com",
      metadata: { page: "visit" },
      experiments: [{ key: "room-agent", unitId: room.id }],
    });
  });

  it("returns updated: true on a 200 replace", async () => {
    mockFetch({ status: 200, json: { success: true, ratingId: "r_1", updated: true } });
    await expect(echoes().rate({ subject: room, stars: 2 })).resolves.toEqual({
      ratingId: "r_1",
      updated: true,
    });
  });

  it("sends a dismissal as stars: null, without comment or experiments", async () => {
    const { calls } = mockFetch({ status: 201, json: { success: true, ratingId: "r_2", updated: false } });
    await echoes().rate({ subject: { type: "room", id: "x" }, stars: null, comment: "   " });
    expect(calls[0].body).toEqual({
      subject: { type: "room", id: "x" },
      stars: null,
      metadata: {},
    });
  });

  it("sends a numeric version as a string and uses the default user and metadata", async () => {
    const { calls } = mockFetch({ status: 201, json: { success: true, ratingId: "r", updated: false } });
    await echoes({ defaultUserIdentifier: "u@x.y", defaultMetadata: { app: "ours", page: "a" } }).rate({
      subject: { type: "room", id: "x", version: 7 },
      stars: 5,
      metadata: { page: "b" },
    });
    expect(calls[0].body).toMatchObject({
      subject: { type: "room", id: "x", version: "7" },
      userIdentifier: "u@x.y",
      metadata: { app: "ours", page: "b" },
    });
  });

  it("adds the experiments the experiment client's visitor is in", async () => {
    const { calls } = mockFetch(
      // assign answer
      {
        json: {
          success: true,
          assigned: true,
          variation: { key: "opus", name: "Opus", configuration: null },
          bucketValue: 9821,
          isNewAssignment: true,
          assignmentId: "a_1",
        },
      },
      { json: { success: true, ratingId: "r_3", updated: false } }
    );
    const experiments = new ExperimentClient({
      apiKey: API_KEY,
      baseUrl: BASE,
      visitorId: "visitor-1",
      storage: null,
    });
    await experiments.assign("room-agent");
    expect(experiments.getActiveExperiments()).toEqual({
      "room-agent": { variationKey: "opus", assignmentId: "a_1" },
    });

    await echoes({ experimentClient: experiments }).rate({ subject: room, stars: 5 });
    expect((calls[1].body as RateParams).experiments).toEqual([
      { key: "room-agent", unitId: "visitor-1" },
    ]);

    // An explicit entry wins for its key; others are kept.
    await echoes({ experimentClient: experiments }).rate({
      subject: room,
      stars: 5,
      experiments: [
        { key: "room-agent", unitId: room.id },
        { key: "other", unitId: "u" },
      ],
    });
    expect((calls[2].body as RateParams).experiments).toEqual([
      { key: "room-agent", unitId: room.id },
      { key: "other", unitId: "u" },
    ]);
  });

  it("omits experiments when the experiment client's visitor is in none", async () => {
    const { calls } = mockFetch({ json: { success: true, ratingId: "r", updated: false } });
    const experiments = new ExperimentClient({ apiKey: API_KEY, storage: null });
    await echoes().withExperiments(experiments).rate({ subject: room, stars: 3 });
    expect(calls[0].body).not.toHaveProperty("experiments");
  });

  describe("validates client-side, without calling the API", () => {
    const cases: [string, Partial<RateParams> & Record<string, unknown>, RegExp][] = [
      ["stars 0", { stars: 0 as never }, /stars must be an integer from 1 to 5, or null/],
      ["stars 6", { stars: 6 as never }, /stars must be an integer from 1 to 5, or null/],
      ["stars 3.5", { stars: 3.5 as never }, /stars must be an integer/],
      ["stars '4'", { stars: "4" as never }, /stars must be an integer/],
      ["stars missing", { stars: undefined as never }, /stars must be an integer/],
      ["no subject", { subject: undefined as never }, /subject is required/],
      ["subject.type uppercase", { subject: { type: "Room", id: "x" } }, /subject\.type/],
      ["subject.type empty", { subject: { type: "", id: "x" } }, /subject\.type/],
      ["subject.type too long", { subject: { type: "a".repeat(51), id: "x" } }, /subject\.type/],
      ["subject.type with space", { subject: { type: "my room", id: "x" } }, /subject\.type/],
      ["subject.id empty", { subject: { type: "room", id: "" } }, /subject\.id/],
      ["subject.id too long", { subject: { type: "room", id: "x".repeat(256) } }, /subject\.id/],
      ["subject.version too long", { subject: { type: "room", id: "x", version: "v".repeat(51) } }, /subject\.version/],
      ["comment too long", { comment: "c".repeat(2001) }, /comment must be at most 2000/],
      ["comment not a string", { comment: 42 as never }, /comment must be a string/],
      ["experiments not an array", { experiments: {} as never }, /experiments must be an array/],
      ["experiment without unitId", { experiments: [{ key: "k" }] as never }, /experiments must be an array/],
    ];

    it.each(cases)("%s", async (_name, patch, message) => {
      const { fn } = mockFetch();
      const err = await rejection(echoes().rate({ subject: room, stars: 4, ...patch } as RateParams));
      expect(err.code).toBe(ErrorCodes.INVALID_PAYLOAD);
      expect(err.message).toMatch(message);
      expect(fn).not.toHaveBeenCalled();
    });

    it("accepts the limits themselves", async () => {
      mockFetch({ json: { success: true, ratingId: "r", updated: false } });
      await expect(
        echoes().rate({
          subject: { type: "a.b_c-1".padEnd(50, "x"), id: "x".repeat(255), version: "v".repeat(50) },
          stars: 1,
          comment: "c".repeat(2000),
        })
      ).resolves.toEqual({ ratingId: "r", updated: false });
    });
  });

  it("maps a 400 to INVALID_PAYLOAD with the server's message", async () => {
    mockFetch({ status: 400, json: { success: false, error: "subject.id is too long" } });
    const err = await rejection(echoes().rate({ subject: room, stars: 4 }));
    expect(err).toMatchObject({
      code: ErrorCodes.INVALID_PAYLOAD,
      statusCode: 400,
      message: "subject.id is too long",
    });
  });

  it("throws UNKNOWN on a 2xx without a rating id", async () => {
    mockFetch({ status: 200, json: { success: false, error: "odd" } });
    const err = await rejection(echoes().rate({ subject: room, stars: 4 }));
    expect(err).toMatchObject({ code: ErrorCodes.UNKNOWN, message: "odd" });
  });
});

describe("error mapping (send and rate)", () => {
  const call = {
    send: (e: Echoes) => e.send({ category: "bug", message: "broken" }),
    rate: (e: Echoes) => e.rate({ subject: room, stars: 4 }),
  };

  describe.each(Object.entries(call))("%s", (_name, run) => {
    it.each([
      [403, "API key is disabled", ErrorCodes.INVALID_API_KEY, "API key is disabled"],
      [403, "Origin not allowed", ErrorCodes.ORIGIN_NOT_ALLOWED, "Origin not allowed"],
      [
        403,
        "Monthly feedback limit reached. Please upgrade your plan for more capacity.",
        ErrorCodes.QUOTA_EXCEEDED,
        "Monthly feedback limit reached. Please upgrade your plan for more capacity.",
      ],
      [403, "Something else entirely", ErrorCodes.FORBIDDEN, "Something else entirely"],
      [403, undefined, ErrorCodes.FORBIDDEN, "Forbidden"],
      [401, "Invalid API key", ErrorCodes.INVALID_API_KEY, "Invalid or missing API key"],
      [404, "Project not found", ErrorCodes.NOT_FOUND, "Project not found"],
      [429, "Rate limit exceeded", ErrorCodes.RATE_LIMITED, "Rate limit exceeded. Please try again later."],
      [500, "Internal error", ErrorCodes.UNKNOWN, "Internal error"],
    ] as const)("%i %s → %s", async (status, error, code, message) => {
      mockFetch({ status, json: error === undefined ? { success: false } : { success: false, error } });
      const err = await rejection(run(echoes()));
      expect(err.code).toBe(code);
      expect(err.statusCode).toBe(status);
      expect(err.message).toBe(message);
    });

    it("maps a non-JSON error page by status", async () => {
      mockFetch({ status: 502, text: "<html>Bad gateway</html>" });
      const err = await rejection(run(echoes()));
      expect(err).toMatchObject({ code: ErrorCodes.UNKNOWN, statusCode: 502 });
    });

    it("maps a network failure to NETWORK_ERROR", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new TypeError("fetch failed");
      }));
      const err = await rejection(run(echoes()));
      expect(err).toMatchObject({ code: ErrorCodes.NETWORK_ERROR, message: "fetch failed" });
    });

    it("maps a timeout to TIMEOUT", async () => {
      hangingFetch();
      const err = await rejection(run(echoes({ timeout: 20 })));
      expect(err).toMatchObject({ code: ErrorCodes.TIMEOUT, message: "Request timed out after 20ms" });
    });
  });
});

describe("send()", () => {
  it("keeps its request shape and adds _experiments metadata", async () => {
    const { calls } = mockFetch({ status: 201, json: { success: true, feedbackId: "f_1" } });
    const experiments = new ExperimentClient({ apiKey: API_KEY, storage: null });
    vi.spyOn(experiments, "getActiveExperiments").mockReturnValue({
      checkout: { variationKey: "b", assignmentId: "a_9" },
    });
    const result = await echoes({ experimentClient: experiments }).send({
      category: "bug",
      message: "broken",
      userIdentifier: "u@x.y",
      metadata: { k: 1 },
    });
    expect(result).toEqual({ success: true, feedbackId: "f_1" });
    expect(calls[0].url).toBe(`${BASE}/api/v1/feedback`);
    expect(calls[0].body).toEqual({
      category: "bug",
      message: "broken",
      userIdentifier: "u@x.y",
      metadata: { k: 1, _experiments: { checkout: { variationKey: "b", assignmentId: "a_9" } } },
    });
  });
});
