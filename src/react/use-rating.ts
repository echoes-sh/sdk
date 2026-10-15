import { useState, useCallback, useRef, useEffect } from "react";
import { useEchoes } from "./context";
import type {
  EchoesError,
  RateParams,
  RateResult,
  RatingStars,
  RatingSubject,
} from "../types";

/**
 * Status of a rating request
 */
export type RatingStatus = "idle" | "submitting" | "rated" | "dismissed" | "error";

/**
 * Defaults applied to every rate/dismiss call of a useRating hook
 */
export interface UseRatingOptions {
  userIdentifier?: string;
  metadata?: Record<string, unknown>;
  experiments?: RateParams["experiments"];
}

/**
 * Per-call extras for rate/dismiss (merged over the hook's options)
 */
export type RateExtras = Omit<RateParams, "subject" | "stars">;

export interface UseRatingResult {
  /** Send 1–5 stars, with an optional comment. Rejects with an EchoesError on failure. */
  rate: (stars: RatingStars, extras?: RateExtras) => Promise<RateResult>;
  /** Send a dismissal (stars: null). Rejects with an EchoesError on failure. */
  dismiss: (extras?: Omit<RateExtras, "comment">) => Promise<RateResult>;
  status: RatingStatus;
  error: EchoesError | null;
  /** The last successful answer */
  result: RateResult | null;
  /** Back to "idle" */
  reset: () => void;
}

/**
 * Hook for rating a subject, with status and error state.
 * Must be used within an EchoesProvider.
 *
 * @example
 * ```tsx
 * const { rate, dismiss, status, error } = useRating({ type: "room", id: roomId });
 *
 * <button onClick={() => rate(5)}>Love it</button>
 * <button onClick={() => dismiss()}>Not now</button>
 * ```
 */
export function useRating(
  subject: RatingSubject,
  options: UseRatingOptions = {}
): UseRatingResult {
  const client = useEchoes();
  const [status, setStatus] = useState<RatingStatus>("idle");
  const [error, setError] = useState<EchoesError | null>(null);
  const [result, setResult] = useState<RateResult | null>(null);

  // Read the latest subject/options at call time without re-creating
  // callbacks on every render (object literals change identity each render).
  const latest = useRef({ subject, options });
  latest.current = { subject, options };

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = useCallback(
    async (stars: RatingStars | null, extras?: RateExtras): Promise<RateResult> => {
      const { subject: s, options: o } = latest.current;
      if (mounted.current) {
        setStatus("submitting");
        setError(null);
      }
      try {
        const metadata =
          o.metadata || extras?.metadata
            ? { ...o.metadata, ...extras?.metadata }
            : undefined;
        const response = await client.rate({
          subject: s,
          stars,
          comment: extras?.comment,
          userIdentifier: extras?.userIdentifier ?? o.userIdentifier,
          metadata,
          experiments: extras?.experiments ?? o.experiments,
        });
        if (mounted.current) {
          setResult(response);
          setStatus(stars === null ? "dismissed" : "rated");
        }
        return response;
      } catch (err) {
        if (mounted.current) {
          setError(err as EchoesError);
          setStatus("error");
        }
        throw err;
      }
    },
    [client]
  );

  const rate = useCallback(
    (stars: RatingStars, extras?: RateExtras) => submit(stars, extras),
    [submit]
  );

  const dismiss = useCallback(
    (extras?: Omit<RateExtras, "comment">) => submit(null, extras),
    [submit]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setResult(null);
  }, []);

  return { rate, dismiss, status, error, result, reset };
}
