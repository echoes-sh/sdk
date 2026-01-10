import {
  useState,
  useCallback,
  type FormEvent,
  type CSSProperties,
} from "react";
import { useFeedback } from "./use-feedback";
import type { FeedbackCategory } from "../types";

const categories: { value: FeedbackCategory; label: string; emoji: string }[] = [
  { value: "bug", label: "Bug", emoji: "🐛" },
  { value: "feature", label: "Feature", emoji: "💡" },
  { value: "question", label: "Question", emoji: "❓" },
  { value: "praise", label: "Praise", emoji: "🎉" },
];

export interface FeedbackWidgetProps {
  /**
   * User identifier to attach to feedback
   */
  userIdentifier?: string;
  /**
   * Additional metadata to attach to feedback
   */
  metadata?: Record<string, unknown>;
  /**
   * Callback when feedback is submitted successfully
   */
  onSuccess?: (feedbackId: string) => void;
  /**
   * Callback when feedback submission fails
   */
  onError?: (error: Error) => void;
  /**
   * Custom styles for the widget container
   */
  style?: CSSProperties;
  /**
   * Custom class name for the widget container
   */
  className?: string;
  /**
   * Placeholder text for the message input
   */
  placeholder?: string;
  /**
   * Submit button text
   */
  submitText?: string;
  /**
   * Success message text
   */
  successText?: string;
  /**
   * Whether to show category selector
   * @default true
   */
  showCategories?: boolean;
  /**
   * Default category
   * @default "bug"
   */
  defaultCategory?: FeedbackCategory;
  /**
   * Theme variant
   * @default "light"
   */
  theme?: "light" | "dark";
}

const lightTheme: Record<string, CSSProperties> = {
  container: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    maxWidth: "400px",
    padding: "16px",
    borderRadius: "12px",
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
  },
  categoryGroup: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap" as const,
  },
  categoryButton: {
    padding: "6px 12px",
    borderRadius: "6px",
    border: "1px solid #e5e7eb",
    backgroundColor: "#f9fafb",
    cursor: "pointer",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  categoryButtonActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
    color: "#ffffff",
  },
  textarea: {
    width: "100%",
    minHeight: "100px",
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    fontSize: "14px",
    resize: "vertical" as const,
    fontFamily: "inherit",
    boxSizing: "border-box" as const,
  },
  submitButton: {
    width: "100%",
    padding: "10px 16px",
    marginTop: "12px",
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
  successMessage: {
    textAlign: "center" as const,
    padding: "24px",
    color: "#059669",
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
    border: "1px solid #374151",
  },
  categoryButton: {
    ...lightTheme.categoryButton,
    backgroundColor: "#374151",
    borderColor: "#4b5563",
    color: "#f3f4f6",
  },
  textarea: {
    ...lightTheme.textarea,
    backgroundColor: "#374151",
    borderColor: "#4b5563",
    color: "#f3f4f6",
  },
  errorMessage: {
    ...lightTheme.errorMessage,
    backgroundColor: "#7f1d1d",
    color: "#fecaca",
  },
};

/**
 * Pre-built feedback widget component
 *
 * @example
 * ```tsx
 * import { EchoesProvider, FeedbackWidget } from "@echoes/sdk/react";
 *
 * function App() {
 *   return (
 *     <EchoesProvider config={{ apiKey: "ek_live_xxx" }}>
 *       <FeedbackWidget
 *         userIdentifier="user@example.com"
 *         onSuccess={(id) => console.log("Submitted:", id)}
 *       />
 *     </EchoesProvider>
 *   );
 * }
 * ```
 */
export function FeedbackWidget({
  userIdentifier,
  metadata,
  onSuccess,
  onError,
  style,
  className,
  placeholder = "Tell us what you think...",
  submitText = "Send Feedback",
  successText = "Thanks for your feedback! 🙏",
  showCategories = true,
  defaultCategory = "bug",
  theme = "light",
}: FeedbackWidgetProps) {
  const [category, setCategory] = useState<FeedbackCategory>(defaultCategory);
  const [message, setMessage] = useState("");
  const { send, isLoading, isSuccess, isError, error, reset } = useFeedback();

  const styles = theme === "dark" ? darkTheme : lightTheme;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      if (!message.trim()) return;

      try {
        const response = await send({
          category,
          message: message.trim(),
          userIdentifier,
          metadata,
        });

        if (response.success) {
          onSuccess?.(response.feedbackId);
          setMessage("");
        }
      } catch (err) {
        onError?.(err as Error);
      }
    },
    [category, message, userIdentifier, metadata, send, onSuccess, onError]
  );

  if (isSuccess) {
    return (
      <div style={{ ...styles.container, ...style }} className={className}>
        <div style={styles.successMessage}>
          <p style={{ fontSize: "24px", marginBottom: "8px" }}>✓</p>
          <p>{successText}</p>
          <button
            onClick={reset}
            style={{
              ...styles.submitButton,
              marginTop: "16px",
              backgroundColor: "transparent",
              color: theme === "dark" ? "#9ca3af" : "#6b7280",
              border: `1px solid ${theme === "dark" ? "#4b5563" : "#e5e7eb"}`,
            }}
          >
            Send more feedback
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.container, ...style }} className={className}>
      <form onSubmit={handleSubmit}>
        {showCategories && (
          <div style={styles.categoryGroup}>
            {categories.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                style={{
                  ...styles.categoryButton,
                  ...(category === cat.value ? styles.categoryButtonActive : {}),
                }}
              >
                <span>{cat.emoji}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          style={styles.textarea}
          disabled={isLoading}
        />

        {isError && error && (
          <div style={styles.errorMessage}>{error.message}</div>
        )}

        <button
          type="submit"
          disabled={isLoading || !message.trim()}
          style={{
            ...styles.submitButton,
            ...(isLoading || !message.trim() ? styles.submitButtonDisabled : {}),
          }}
        >
          {isLoading ? "Sending..." : submitText}
        </button>
      </form>
    </div>
  );
}
