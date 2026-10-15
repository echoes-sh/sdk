import {
  EchoesConfig,
  SendFeedbackParams,
  FeedbackResponse,
  EchoesError,
  ErrorCodes,
  ExperimentClient,
  RateParams,
  RateResult,
  RatingExperimentRef,
} from "./types";

const DEFAULT_BASE_URL = "https://echoes.sh";
const DEFAULT_TIMEOUT = 10000;

/** Limits from the contract (echoes-v2 docs/ratings-and-experiments.md) */
const SUBJECT_TYPE_PATTERN = /^[a-z0-9_.-]{1,50}$/;
const SUBJECT_ID_MAX = 255;
const SUBJECT_VERSION_MAX = 50;
const COMMENT_MAX = 2000;

/**
 * Turn an error answer from the API into an EchoesError.
 *
 * A 403 is told apart by the server's error string ("API key is disabled",
 * "Origin not allowed", "Monthly feedback limit reached…"), which is kept as
 * the message.
 */
export function errorFromResponse(
  status: number,
  data: { error?: unknown } | null | undefined
): EchoesError {
  const serverMessage =
    data && typeof data.error === "string" && data.error.trim()
      ? data.error
      : undefined;
  const errorMessage = serverMessage ?? "Unknown error occurred";

  switch (status) {
    case 400:
      return new EchoesError(errorMessage, ErrorCodes.INVALID_PAYLOAD, status);
    case 401:
      return new EchoesError(
        "Invalid or missing API key",
        ErrorCodes.INVALID_API_KEY,
        status
      );
    case 403: {
      const m = serverMessage ?? "";
      if (/disabled|revoked/i.test(m)) {
        return new EchoesError(m, ErrorCodes.INVALID_API_KEY, status);
      }
      if (/origin/i.test(m)) {
        return new EchoesError(m, ErrorCodes.ORIGIN_NOT_ALLOWED, status);
      }
      if (/quota|limit reached|upgrade/i.test(m)) {
        return new EchoesError(m, ErrorCodes.QUOTA_EXCEEDED, status);
      }
      return new EchoesError(m || "Forbidden", ErrorCodes.FORBIDDEN, status);
    }
    case 404:
      return new EchoesError(
        serverMessage ?? "Not found",
        ErrorCodes.NOT_FOUND,
        status
      );
    case 429:
      return new EchoesError(
        "Rate limit exceeded. Please try again later.",
        ErrorCodes.RATE_LIMITED,
        status
      );
    default:
      return new EchoesError(errorMessage, ErrorCodes.UNKNOWN, status);
  }
}

/**
 * Echoes client for sending feedback to your Echoes project
 *
 * @example
 * ```typescript
 * import { Echoes } from "@echoessh/sdk";
 *
 * const echoes = new Echoes({
 *   apiKey: "ek_live_xxxxxxxxxxxxx",
 * });
 *
 * await echoes.send({
 *   category: "bug",
 *   message: "Button doesn't work on mobile",
 *   userIdentifier: "user@example.com",
 * });
 * ```
 */
export class Echoes {
  private config: Required<
    Pick<EchoesConfig, "apiKey" | "baseUrl" | "timeout" | "debug">
  > &
    Pick<EchoesConfig, "defaultUserIdentifier" | "defaultMetadata" | "experimentClient">;

  constructor(config: EchoesConfig) {
    if (!config.apiKey) {
      throw new EchoesError(
        "API key is required",
        ErrorCodes.INVALID_API_KEY
      );
    }

    if (!config.apiKey.startsWith("ek_")) {
      throw new EchoesError(
        "Invalid API key format. API key should start with 'ek_'",
        ErrorCodes.INVALID_API_KEY
      );
    }

    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE_URL,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      debug: config.debug ?? false,
      defaultUserIdentifier: config.defaultUserIdentifier,
      defaultMetadata: config.defaultMetadata,
      experimentClient: config.experimentClient,
    };

    this.log("Echoes client initialized");
  }

  /**
   * Send feedback to your Echoes project
   *
   * @param params - Feedback parameters
   * @returns Promise resolving to the feedback response
   * @throws {EchoesError} When the request fails
   *
   * @example
   * ```typescript
   * // Send a bug report
   * const result = await echoes.send({
   *   category: "bug",
   *   message: "Login button not responding",
   *   userIdentifier: "user@example.com",
   *   metadata: { browser: "Chrome", version: "120.0" }
   * });
   *
   * if (result.success) {
   *   console.log("Feedback submitted:", result.feedbackId);
   * }
   * ```
   */
  async send(params: SendFeedbackParams): Promise<FeedbackResponse> {
    this.validateParams(params);

    // Build metadata with experiment context if available
    const metadata: Record<string, unknown> = {
      ...this.config.defaultMetadata,
      ...params.metadata,
    };

    // Auto-inject active experiments if experimentClient is configured
    if (this.config.experimentClient) {
      const activeExperiments = this.config.experimentClient.getActiveExperiments();
      if (Object.keys(activeExperiments).length > 0) {
        metadata._experiments = activeExperiments;
        this.log("Injecting experiment context:", activeExperiments);
      }
    }

    const payload = {
      category: params.category,
      message: params.message,
      userIdentifier: params.userIdentifier ?? this.config.defaultUserIdentifier,
      metadata,
    };

    this.log("Sending feedback:", payload);

    const data = await this.post("/api/v1/feedback", payload);
    this.log("Feedback submitted successfully:", data);
    return data as FeedbackResponse;
  }

  /**
   * Rate something the app showed: 1–5 stars, or `null` when the person
   * dismissed the question, with an optional comment.
   *
   * When the client has an experiment client, the experiments its visitor is
   * in are added to `experiments` automatically.
   *
   * @returns `{ ratingId, updated }`; `updated` is true when the same
   *   `userIdentifier` had already rated the same subject version
   * @throws {EchoesError} On invalid parameters or when the request fails
   *
   * @example
   * ```typescript
   * const { ratingId } = await echoes.rate({
   *   subject: { type: "room", id: roomId, version: "3" },
   *   stars: 4,
   *   comment: "Lovely, but the sofa faces the wall",
   *   userIdentifier: "user@example.com",
   *   experiments: [{ key: "room-agent", unitId: roomId }],
   * });
   * ```
   */
  async rate(params: RateParams): Promise<RateResult> {
    const comment = this.validateRating(params);

    const metadata: Record<string, unknown> = {
      ...this.config.defaultMetadata,
      ...params.metadata,
    };

    const experiments = this.ratingExperiments(params.experiments);

    const subject: { type: string; id: string; version?: string } = {
      type: params.subject.type,
      id: params.subject.id,
    };
    if (params.subject.version !== undefined && params.subject.version !== null) {
      subject.version = String(params.subject.version);
    }

    const payload: Record<string, unknown> = {
      subject,
      stars: params.stars,
      userIdentifier: params.userIdentifier ?? this.config.defaultUserIdentifier,
      metadata,
    };
    if (comment) payload.comment = comment;
    if (experiments.length > 0) payload.experiments = experiments;

    this.log("Sending rating:", payload);

    const data = (await this.post("/api/v1/ratings", payload)) as {
      success?: boolean;
      ratingId?: string;
      updated?: boolean;
      error?: string;
    };

    if (data.success === false || typeof data.ratingId !== "string") {
      throw new EchoesError(
        data.error || "Unexpected response from the ratings endpoint",
        ErrorCodes.UNKNOWN
      );
    }

    this.log("Rating submitted:", data);
    return { ratingId: data.ratingId, updated: data.updated === true };
  }

  /**
   * Send a bug report
   * Convenience method for sending bug feedback
   */
  async bug(
    message: string,
    options?: Omit<SendFeedbackParams, "category" | "message">
  ): Promise<FeedbackResponse> {
    return this.send({ ...options, category: "bug", message });
  }

  /**
   * Send a feature request
   * Convenience method for sending feature feedback
   */
  async feature(
    message: string,
    options?: Omit<SendFeedbackParams, "category" | "message">
  ): Promise<FeedbackResponse> {
    return this.send({ ...options, category: "feature", message });
  }

  /**
   * Send a question
   * Convenience method for sending question feedback
   */
  async question(
    message: string,
    options?: Omit<SendFeedbackParams, "category" | "message">
  ): Promise<FeedbackResponse> {
    return this.send({ ...options, category: "question", message });
  }

  /**
   * Send praise/positive feedback
   * Convenience method for sending praise feedback
   */
  async praise(
    message: string,
    options?: Omit<SendFeedbackParams, "category" | "message">
  ): Promise<FeedbackResponse> {
    return this.send({ ...options, category: "praise", message });
  }

  /**
   * Create a new client with updated configuration
   * Useful for setting user context
   */
  withUser(userIdentifier: string): Echoes {
    return new Echoes({
      ...this.config,
      defaultUserIdentifier: userIdentifier,
    });
  }

  /**
   * Create a new client with additional default metadata
   */
  withMetadata(metadata: Record<string, unknown>): Echoes {
    return new Echoes({
      ...this.config,
      defaultMetadata: {
        ...this.config.defaultMetadata,
        ...metadata,
      },
    });
  }

  /**
   * Create a new client with an experiment client for automatic context injection
   */
  withExperiments(experimentClient: ExperimentClient): Echoes {
    return new Echoes({
      ...this.config,
      experimentClient,
    });
  }

  /**
   * Get the current experiment client if configured
   */
  getExperimentClient(): ExperimentClient | undefined {
    return this.config.experimentClient;
  }

  private validateParams(params: SendFeedbackParams): void {
    const validCategories = ["bug", "feature", "question", "praise"];

    if (!validCategories.includes(params.category)) {
      throw new EchoesError(
        `Invalid category "${params.category}". Must be one of: ${validCategories.join(", ")}`,
        ErrorCodes.INVALID_PAYLOAD
      );
    }

    if (!params.message || typeof params.message !== "string") {
      throw new EchoesError(
        "Message is required and must be a string",
        ErrorCodes.INVALID_PAYLOAD
      );
    }

    if (params.message.trim().length === 0) {
      throw new EchoesError(
        "Message cannot be empty",
        ErrorCodes.INVALID_PAYLOAD
      );
    }
  }

  /**
   * Validate rating parameters; returns the trimmed comment, if any.
   */
  private validateRating(params: RateParams): string | undefined {
    const invalid = (message: string) =>
      new EchoesError(message, ErrorCodes.INVALID_PAYLOAD);

    if (!params || typeof params !== "object") {
      throw invalid("Rating parameters are required");
    }

    const subject = params.subject;
    if (!subject || typeof subject !== "object") {
      throw invalid("subject is required");
    }
    if (typeof subject.type !== "string" || !SUBJECT_TYPE_PATTERN.test(subject.type)) {
      throw invalid(
        "subject.type must match ^[a-z0-9_.-]{1,50}$ (lowercase letters, digits, _ . -)"
      );
    }
    if (
      typeof subject.id !== "string" ||
      subject.id.length === 0 ||
      subject.id.length > SUBJECT_ID_MAX
    ) {
      throw invalid(`subject.id must be a string of 1 to ${SUBJECT_ID_MAX} characters`);
    }
    if (subject.version !== undefined && subject.version !== null) {
      const version = subject.version;
      if (
        (typeof version !== "string" && typeof version !== "number") ||
        (typeof version === "number" && !Number.isFinite(version)) ||
        String(version).length > SUBJECT_VERSION_MAX
      ) {
        throw invalid(
          `subject.version must be a string of at most ${SUBJECT_VERSION_MAX} characters`
        );
      }
    }

    const stars = params.stars;
    if (
      stars !== null &&
      !(typeof stars === "number" && Number.isInteger(stars) && stars >= 1 && stars <= 5)
    ) {
      throw invalid("stars must be an integer from 1 to 5, or null");
    }

    let comment: string | undefined;
    if (params.comment !== undefined && params.comment !== null) {
      if (typeof params.comment !== "string") {
        throw invalid("comment must be a string");
      }
      comment = params.comment.trim();
      if (comment.length > COMMENT_MAX) {
        throw invalid(`comment must be at most ${COMMENT_MAX} characters`);
      }
      if (comment.length === 0) comment = undefined;
    }

    if (params.userIdentifier !== undefined && typeof params.userIdentifier !== "string") {
      throw invalid("userIdentifier must be a string");
    }

    if (params.experiments !== undefined) {
      if (!Array.isArray(params.experiments)) {
        throw invalid("experiments must be an array of { key, unitId }");
      }
      for (const e of params.experiments) {
        if (
          !e ||
          typeof e.key !== "string" ||
          e.key.length === 0 ||
          typeof e.unitId !== "string"
        ) {
          throw invalid("experiments must be an array of { key, unitId }");
        }
      }
    }

    return comment;
  }

  /**
   * The experiments a rating belongs to: the explicit ones, plus those the
   * experiment client's visitor is in (an explicit entry wins for its key).
   */
  private ratingExperiments(
    explicit: RatingExperimentRef[] | undefined
  ): RatingExperimentRef[] {
    const result: RatingExperimentRef[] = (explicit ?? []).map((e) => ({
      key: e.key,
      unitId: e.unitId,
    }));
    const client = this.config.experimentClient;
    if (!client) return result;

    const explicitKeys = new Set(result.map((e) => e.key));
    const active = client.getActiveExperiments();
    const visitorId = client.getVisitorId();
    const auto = Object.keys(active)
      .filter((key) => !explicitKeys.has(key))
      .map((key) => ({ key, unitId: visitorId }));
    if (auto.length > 0) {
      this.log("Adding experiment context to rating:", auto);
    }
    return [...result, ...auto];
  }

  /**
   * POST a JSON payload to the API. Resolves with the parsed answer on a 2xx,
   * throws an EchoesError otherwise.
   */
  private async post(path: string, payload: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new EchoesError(
          `Request timed out after ${this.config.timeout}ms`,
          ErrorCodes.TIMEOUT
        );
      }
      throw new EchoesError(
        error instanceof Error ? error.message : "Network error occurred",
        ErrorCodes.NETWORK_ERROR
      );
    }

    let data: unknown = null;
    try {
      data = await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        clearTimeout(timeoutId);
        throw new EchoesError(
          `Request timed out after ${this.config.timeout}ms`,
          ErrorCodes.TIMEOUT
        );
      }
      // Not JSON (e.g. a proxy's error page): fall through with no data.
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      this.log(`Request to ${path} failed:`, response.status, data);
      throw errorFromResponse(response.status, data as { error?: unknown } | null);
    }
    if (data === null || typeof data !== "object") {
      throw new EchoesError(
        "Invalid response from Echoes (not JSON)",
        ErrorCodes.UNKNOWN,
        response.status
      );
    }
    return data;
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log("[Echoes]", ...args);
    }
  }
}

/**
 * Create an Echoes client instance
 *
 * @example
 * ```typescript
 * import { createEchoes } from "@echoessh/sdk";
 *
 * const echoes = createEchoes({
 *   apiKey: process.env.ECHOES_API_KEY!,
 * });
 * ```
 */
export function createEchoes(config: EchoesConfig): Echoes {
  return new Echoes(config);
}
