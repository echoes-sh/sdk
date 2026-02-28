import {
  EchoesConfig,
  SendFeedbackParams,
  FeedbackResponse,
  EchoesError,
  ErrorCodes,
  ExperimentClient,
} from "./types";

const DEFAULT_BASE_URL = "https://echoes.sh";
const DEFAULT_TIMEOUT = 10000;

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        this.log("Feedback submission failed:", data);
        return this.handleErrorResponse(response.status, data);
      }

      this.log("Feedback submitted successfully:", data);
      return data as FeedbackResponse;
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

  private handleErrorResponse(
    status: number,
    data: { error?: string }
  ): FeedbackResponse {
    const errorMessage = data.error || "Unknown error occurred";

    switch (status) {
      case 400:
        throw new EchoesError(errorMessage, ErrorCodes.INVALID_PAYLOAD, status);
      case 401:
        throw new EchoesError(
          "Invalid or missing API key",
          ErrorCodes.INVALID_API_KEY,
          status
        );
      case 403:
        throw new EchoesError(
          "API key is disabled",
          ErrorCodes.INVALID_API_KEY,
          status
        );
      case 429:
        throw new EchoesError(
          "Rate limit exceeded. Please try again later.",
          ErrorCodes.RATE_LIMITED,
          status
        );
      default:
        throw new EchoesError(errorMessage, ErrorCodes.UNKNOWN, status);
    }
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
