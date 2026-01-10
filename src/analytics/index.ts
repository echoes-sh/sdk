// Types
export * from "./types";

// Core classes
export { SessionManager } from "./session-manager";
export { EventBatcher } from "./event-batcher";
export { RecordingManager } from "./recording-manager";

// Trackers
export {
  ClickTracker,
  ScrollTracker,
  ErrorTracker,
  PageViewTracker,
  VisibilityTracker,
} from "./trackers";

// Utilities
export { compressToBase64, decompressFromBase64 } from "./compression";

// React components (re-exported from react/analytics)
// Note: These are exported separately via the /analytics entry point
