import { useState, useCallback } from "react";
import { useEchoes } from "./context";
import type {
  FeedbackCategory,
  SendFeedbackParams,
  FeedbackResponse,
  EchoesError,
} from "../types";

interface UseFeedbackState {
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: EchoesError | null;
  data: FeedbackResponse | null;
}

interface UseFeedbackReturn extends UseFeedbackState {
  /**
   * Send feedback
   */
  send: (params: SendFeedbackParams) => Promise<FeedbackResponse>;
  /**
   * Send a bug report
   */
  bug: (message: string, options?: Omit<SendFeedbackParams, "category" | "message">) => Promise<FeedbackResponse>;
  /**
   * Send a feature request
   */
  feature: (message: string, options?: Omit<SendFeedbackParams, "category" | "message">) => Promise<FeedbackResponse>;
  /**
   * Send a question
   */
  question: (message: string, options?: Omit<SendFeedbackParams, "category" | "message">) => Promise<FeedbackResponse>;
  /**
   * Send praise
   */
  praise: (message: string, options?: Omit<SendFeedbackParams, "category" | "message">) => Promise<FeedbackResponse>;
  /**
   * Reset the state
   */
  reset: () => void;
}

/**
 * Hook for sending feedback with loading and error states
 *
 * @example
 * ```tsx
 * import { useFeedback } from "@echoes/sdk/react";
 *
 * function FeedbackForm() {
 *   const { send, isLoading, isSuccess, error } = useFeedback();
 *   const [message, setMessage] = useState("");
 *
 *   const handleSubmit = async (e) => {
 *     e.preventDefault();
 *     await send({ category: "bug", message });
 *   };
 *
 *   if (isSuccess) return <p>Thanks for your feedback!</p>;
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
 *       <button disabled={isLoading}>
 *         {isLoading ? "Sending..." : "Submit"}
 *       </button>
 *       {error && <p>{error.message}</p>}
 *     </form>
 *   );
 * }
 * ```
 */
export function useFeedback(): UseFeedbackReturn {
  const client = useEchoes();
  const [state, setState] = useState<UseFeedbackState>({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
    data: null,
  });

  const reset = useCallback(() => {
    setState({
      isLoading: false,
      isSuccess: false,
      isError: false,
      error: null,
      data: null,
    });
  }, []);

  const send = useCallback(
    async (params: SendFeedbackParams): Promise<FeedbackResponse> => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        isError: false,
        error: null,
      }));

      try {
        const response = await client.send(params);
        setState({
          isLoading: false,
          isSuccess: response.success,
          isError: !response.success,
          error: null,
          data: response,
        });
        return response;
      } catch (error) {
        const echoesError = error as EchoesError;
        setState({
          isLoading: false,
          isSuccess: false,
          isError: true,
          error: echoesError,
          data: null,
        });
        throw error;
      }
    },
    [client]
  );

  const createCategoryMethod = useCallback(
    (category: FeedbackCategory) =>
      (message: string, options?: Omit<SendFeedbackParams, "category" | "message">) =>
        send({ ...options, category, message }),
    [send]
  );

  return {
    ...state,
    send,
    bug: createCategoryMethod("bug"),
    feature: createCategoryMethod("feature"),
    question: createCategoryMethod("question"),
    praise: createCategoryMethod("praise"),
    reset,
  };
}
