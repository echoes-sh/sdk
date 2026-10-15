import {
  useState,
  useCallback,
  useRef,
  useId,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRating } from "./use-rating";
import type {
  EchoesError,
  RateResult,
  RatingExperimentRef,
  RatingStars,
  RatingSubject,
} from "../types";

const STAR_VALUES: RatingStars[] = [1, 2, 3, 4, 5];

/** Stars at or below this ask for an optional comment before sending */
const COMMENT_AT_OR_BELOW = 3;

/**
 * Every string the widget shows or announces. All are overridable, for i18n.
 */
export interface RatingWidgetLabels {
  /** Question above the stars */
  title: string;
  /** Accessible name of each star */
  star: (stars: RatingStars) => string;
  /** Accessible name of the dismiss button */
  dismiss: string;
  /** Label of the comment box (1–3 stars) */
  commentLabel: string;
  /** Placeholder of the comment box */
  commentPlaceholder: string;
  /** Submit button in the comment step */
  submit: string;
  /** Submit button while sending */
  submitting: string;
  /** Sends the stars without a comment */
  skip: string;
  /** Thank-you message */
  thanks: string;
}

export const defaultRatingWidgetLabels: RatingWidgetLabels = {
  title: "How would you rate this?",
  star: (n) => (n === 1 ? "1 star" : `${n} stars`),
  dismiss: "Dismiss",
  commentLabel: "What could be better?",
  commentPlaceholder: "Optional",
  submit: "Send",
  submitting: "Sending...",
  skip: "Skip",
  thanks: "Thanks for your rating!",
};

export interface RatingWidgetProps {
  /** What is being rated */
  subject: RatingSubject;
  /** User identifier to attach to the rating */
  userIdentifier?: string;
  /** Additional metadata to attach to the rating */
  metadata?: Record<string, unknown>;
  /** Experiment units the rating belongs to */
  experiments?: RatingExperimentRef[];
  /** Called once the rating is stored */
  onRated?: (result: RateResult & { stars: RatingStars; comment?: string }) => void;
  /**
   * Called when the person dismisses the widget. A dismissal (stars: null)
   * is sent; the widget then renders nothing.
   */
  onDismiss?: () => void;
  /** Called when sending fails */
  onError?: (error: EchoesError | Error) => void;
  /**
   * Show the dismiss button
   * @default true
   */
  showDismiss?: boolean;
  /**
   * Theme variant
   * @default "light"
   */
  theme?: "light" | "dark";
  /** Custom class name for the widget container */
  className?: string;
  /** Custom styles for the widget container */
  style?: CSSProperties;
  /** Strings, for i18n; any omitted falls back to English */
  labels?: Partial<RatingWidgetLabels>;
}

const lightTheme: Record<string, CSSProperties> = {
  container: {
    position: "relative",
    fontFamily: "system-ui, -apple-system, sans-serif",
    maxWidth: "400px",
    padding: "16px",
    borderRadius: "12px",
    backgroundColor: "#ffffff",
    color: "#111827",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
    boxSizing: "border-box",
  },
  title: {
    margin: "0 32px 12px 0",
    fontSize: "15px",
    fontWeight: 500,
    lineHeight: 1.4,
  },
  starGroup: {
    display: "flex",
    gap: "4px",
  },
  star: {
    padding: "2px",
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: "28px",
    lineHeight: 1,
    color: "#d1d5db",
    borderRadius: "6px",
  },
  starActive: {
    color: "#f59e0b",
  },
  dismissButton: {
    position: "absolute",
    top: "8px",
    right: "8px",
    width: "28px",
    height: "28px",
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: "18px",
    lineHeight: 1,
    color: "#6b7280",
    borderRadius: "6px",
  },
  commentLabel: {
    display: "block",
    margin: "12px 0 6px",
    fontSize: "14px",
    color: "#374151",
  },
  textarea: {
    width: "100%",
    minHeight: "80px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    fontSize: "14px",
    resize: "vertical",
    fontFamily: "inherit",
    boxSizing: "border-box",
    backgroundColor: "#ffffff",
    color: "#111827",
  },
  actions: {
    display: "flex",
    gap: "8px",
    marginTop: "12px",
  },
  submitButton: {
    flex: 1,
    padding: "10px 16px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#3b82f6",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  },
  submitButtonDisabled: {
    backgroundColor: "#9ca3af",
    cursor: "not-allowed",
  },
  skipButton: {
    padding: "10px 16px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    backgroundColor: "transparent",
    color: "#6b7280",
    fontSize: "14px",
    cursor: "pointer",
  },
  thanks: {
    textAlign: "center",
    padding: "16px 8px",
    color: "#059669",
    margin: 0,
  },
  errorMessage: {
    marginTop: "8px",
    padding: "8px",
    borderRadius: "6px",
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    fontSize: "13px",
  },
};

const darkTheme: Record<string, CSSProperties> = {
  ...lightTheme,
  container: {
    ...lightTheme.container,
    backgroundColor: "#1f2937",
    color: "#f3f4f6",
    border: "1px solid #374151",
  },
  star: {
    ...lightTheme.star,
    color: "#4b5563",
  },
  starActive: {
    color: "#fbbf24",
  },
  dismissButton: {
    ...lightTheme.dismissButton,
    color: "#9ca3af",
  },
  commentLabel: {
    ...lightTheme.commentLabel,
    color: "#d1d5db",
  },
  textarea: {
    ...lightTheme.textarea,
    backgroundColor: "#374151",
    border: "1px solid #4b5563",
    color: "#f3f4f6",
  },
  skipButton: {
    ...lightTheme.skipButton,
    border: "1px solid #4b5563",
    color: "#9ca3af",
  },
  thanks: {
    ...lightTheme.thanks,
    color: "#34d399",
  },
  errorMessage: {
    ...lightTheme.errorMessage,
    backgroundColor: "#7f1d1d",
    color: "#fecaca",
  },
};

type Step = "stars" | "comment" | "thanks" | "dismissed";

/**
 * Pre-built rating widget: five stars, then an optional comment for 1–3
 * stars, then a thank-you. The dismiss button sends `stars: null`.
 * Must be used within an EchoesProvider.
 *
 * The stars are a radio group: Tab focuses it, the arrow keys (and Home/End)
 * move the selection, Enter or Space confirms it, and a click confirms the
 * clicked star.
 *
 * @example
 * ```tsx
 * <RatingWidget
 *   subject={{ type: "room", id: roomId, version: "3" }}
 *   userIdentifier={user.email}
 *   experiments={[{ key: "room-agent", unitId: roomId }]}
 *   onRated={({ stars }) => console.log("Rated", stars)}
 * />
 * ```
 */
export function RatingWidget({
  subject,
  userIdentifier,
  metadata,
  experiments,
  onRated,
  onDismiss,
  onError,
  showDismiss = true,
  theme = "light",
  className,
  style,
  labels: labelOverrides,
}: RatingWidgetProps) {
  const labels: RatingWidgetLabels = { ...defaultRatingWidgetLabels, ...labelOverrides };
  const styles = theme === "dark" ? darkTheme : lightTheme;

  const [step, setStep] = useState<Step>("stars");
  const [selected, setSelected] = useState<RatingStars | null>(null);
  const [hovered, setHovered] = useState<RatingStars | null>(null);
  const [comment, setComment] = useState("");
  const starRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const id = useId();
  const titleId = `${id}-title`;
  const commentId = `${id}-comment`;

  const { rate, dismiss, status, error } = useRating(subject, {
    userIdentifier,
    metadata,
    experiments,
  });
  const isSubmitting = status === "submitting";

  const send = useCallback(
    async (stars: RatingStars, text?: string) => {
      const trimmed = text?.trim() || undefined;
      try {
        const result = await rate(stars, { comment: trimmed });
        setStep("thanks");
        onRated?.({ ...result, stars, comment: trimmed });
      } catch (err) {
        onError?.(err as EchoesError);
      }
    },
    [rate, onRated, onError]
  );

  const commit = useCallback(
    (stars: RatingStars) => {
      if (isSubmitting) return;
      setSelected(stars);
      if (stars <= COMMENT_AT_OR_BELOW) {
        setStep("comment");
      } else {
        void send(stars);
      }
    },
    [isSubmitting, send]
  );

  const handleDismiss = useCallback(async () => {
    setStep("dismissed");
    onDismiss?.();
    try {
      await dismiss();
    } catch (err) {
      onError?.(err as EchoesError);
    }
  }, [dismiss, onDismiss, onError]);

  const moveSelection = useCallback((stars: RatingStars) => {
    setSelected(stars);
    starRefs.current[stars - 1]?.focus();
  }, []);

  const handleStarKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, stars: RatingStars) => {
      let next: number | null = null;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowUp":
          next = stars === 5 ? 1 : stars + 1;
          break;
        case "ArrowLeft":
        case "ArrowDown":
          next = stars === 1 ? 5 : stars - 1;
          break;
        case "Home":
          next = 1;
          break;
        case "End":
          next = 5;
          break;
        default:
          return;
      }
      e.preventDefault();
      // Moving the selection doesn't send: Enter, Space or a click does.
      moveSelection(next as RatingStars);
    },
    [moveSelection]
  );

  const handleCommentSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (selected === null || isSubmitting) return;
      void send(selected, comment);
    },
    [selected, isSubmitting, send, comment]
  );

  if (step === "dismissed") {
    return null;
  }

  if (step === "thanks") {
    return (
      <div style={{ ...styles.container, ...style }} className={className}>
        <p role="status" aria-live="polite" style={styles.thanks}>
          {labels.thanks}
        </p>
      </div>
    );
  }

  const shown = hovered ?? selected ?? 0;
  // Roving tabindex: the selected star (or the first) is the tab stop.
  const tabStop = selected ?? 1;

  return (
    <div style={{ ...styles.container, ...style }} className={className}>
      {showDismiss && step === "stars" && (
        <button
          type="button"
          aria-label={labels.dismiss}
          title={labels.dismiss}
          onClick={handleDismiss}
          disabled={isSubmitting}
          style={styles.dismissButton}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}

      <p id={titleId} style={styles.title}>
        {labels.title}
      </p>

      <div
        role="radiogroup"
        aria-labelledby={titleId}
        style={styles.starGroup}
        onMouseLeave={() => setHovered(null)}
      >
        {STAR_VALUES.map((n) => (
          <button
            key={n}
            ref={(el) => {
              starRefs.current[n - 1] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected === n}
            aria-label={labels.star(n)}
            tabIndex={n === tabStop ? 0 : -1}
            disabled={isSubmitting}
            onClick={() => commit(n)}
            onKeyDown={(e) => handleStarKeyDown(e, n)}
            onMouseEnter={() => setHovered(n)}
            style={{
              ...styles.star,
              ...(n <= shown ? styles.starActive : {}),
            }}
          >
            <span aria-hidden="true">★</span>
          </button>
        ))}
      </div>

      {step === "comment" && (
        <form onSubmit={handleCommentSubmit}>
          <label htmlFor={commentId} style={styles.commentLabel}>
            {labels.commentLabel}
          </label>
          <textarea
            id={commentId}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={labels.commentPlaceholder}
            maxLength={2000}
            disabled={isSubmitting}
            style={styles.textarea}
          />
          <div style={styles.actions}>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                ...styles.submitButton,
                ...(isSubmitting ? styles.submitButtonDisabled : {}),
              }}
            >
              {isSubmitting ? labels.submitting : labels.submit}
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => selected !== null && void send(selected)}
              style={styles.skipButton}
            >
              {labels.skip}
            </button>
          </div>
        </form>
      )}

      {status === "error" && error && (
        <div role="alert" style={styles.errorMessage}>
          {error.message}
        </div>
      )}
    </div>
  );
}
