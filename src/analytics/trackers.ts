import type { EventBatcher } from "./event-batcher";
import type { TrackingEvent } from "./types";

// ============================================================================
// BASE TRACKER
// ============================================================================

interface BaseTrackerConfig {
  batcher: EventBatcher;
  debug?: boolean;
}

abstract class BaseTracker {
  protected batcher: EventBatcher;
  protected debug: boolean;
  protected destroyed: boolean = false;

  constructor(config: BaseTrackerConfig) {
    this.batcher = config.batcher;
    this.debug = config.debug ?? false;
  }

  protected log(...args: unknown[]): void {
    if (this.debug) {
      console.log(`[Echoes:${this.constructor.name}]`, ...args);
    }
  }

  protected addEvent(event: Omit<TrackingEvent, "timestamp" | "url">): void {
    if (this.destroyed) return;

    const fullEvent: TrackingEvent = {
      ...event,
      timestamp: Date.now(),
      url: typeof window !== "undefined" ? window.location.href : "",
    };

    this.batcher.add(fullEvent);
  }

  abstract destroy(): void;
}

// ============================================================================
// CLICK TRACKER
// ============================================================================

interface ClickTrackerConfig extends BaseTrackerConfig {
  /** CSS selectors of elements to ignore */
  ignoredElements?: string[];
}

/**
 * Generates a CSS selector for an element
 */
function generateSelector(element: Element): string {
  if (element.id) {
    return `#${element.id}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body && parts.length < 5) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector = `#${current.id}`;
      parts.unshift(selector);
      break;
    }

    if (current.className && typeof current.className === "string") {
      const classes = current.className
        .split(" ")
        .filter((c) => c && !c.startsWith("_") && !/^[0-9]/.test(c))
        .slice(0, 2)
        .join(".");
      if (classes) {
        selector += `.${classes}`;
      }
    }

    // Add nth-child if there are siblings
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

/**
 * Gets the visible text of an element (truncated)
 */
function getElementText(element: Element): string {
  const text = element.textContent?.trim() || "";
  return text.slice(0, 200);
}

/**
 * Tracks click events for heatmaps
 */
export class ClickTracker extends BaseTracker {
  private clickHandler: (event: MouseEvent) => void;
  private ignoredSelectors: string[];

  constructor(config: ClickTrackerConfig) {
    super(config);
    this.ignoredSelectors = config.ignoredElements ?? [];

    this.clickHandler = this.handleClick.bind(this);
    this.attach();
  }

  private attach(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("click", this.clickHandler, { capture: true, passive: true });
    this.log("Attached click listener");
  }

  private handleClick(event: MouseEvent): void {
    if (this.destroyed) return;

    const target = event.target as Element;
    if (!target) return;

    // Check if element should be ignored
    if (this.shouldIgnore(target)) {
      this.log("Ignoring click on:", target.tagName);
      return;
    }

    // Get page dimensions
    const pageWidth = document.documentElement.scrollWidth;
    const pageHeight = document.documentElement.scrollHeight;

    // Calculate click position
    const x = event.pageX;
    const y = event.pageY;
    const xPercent = pageWidth > 0 ? (x / pageWidth) * 100 : 0;
    const yPercent = pageHeight > 0 ? (y / pageHeight) * 100 : 0;

    this.addEvent({
      type: "click",
      x,
      y,
      xPercent,
      yPercent,
      selector: generateSelector(target),
      elementTag: target.tagName.toLowerCase(),
      elementText: getElementText(target),
      elementClasses: typeof target.className === "string" ? target.className : "",
      elementId: target.id || undefined,
    });

    this.log("Click tracked:", target.tagName, x, y);
  }

  private shouldIgnore(element: Element): boolean {
    for (const selector of this.ignoredSelectors) {
      try {
        if (element.matches(selector) || element.closest(selector)) {
          return true;
        }
      } catch {
        // Invalid selector, ignore
      }
    }
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("click", this.clickHandler, { capture: true });
    }
    this.log("Destroyed");
  }
}

// ============================================================================
// SCROLL TRACKER
// ============================================================================

interface ScrollTrackerConfig extends BaseTrackerConfig {
  /** Minimum percentage change to track (default 25) */
  threshold?: number;
}

/**
 * Tracks scroll depth for analytics
 */
export class ScrollTracker extends BaseTracker {
  private scrollHandler: () => void;
  private threshold: number;
  private lastTrackedDepth: number = 0;
  private maxDepth: number = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ScrollTrackerConfig) {
    super(config);
    this.threshold = config.threshold ?? 25;

    this.scrollHandler = this.handleScroll.bind(this);
    this.attach();
  }

  private attach(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("scroll", this.scrollHandler, { passive: true });

    // Also track on resize (page height might change)
    window.addEventListener("resize", this.scrollHandler, { passive: true });

    // Track initial position
    this.handleScroll();

    this.log("Attached scroll listener");
  }

  private handleScroll(): void {
    if (this.destroyed) return;

    // Debounce to avoid excessive events
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.trackScrollDepth();
    }, 100);
  }

  private trackScrollDepth(): void {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const viewportHeight = window.innerHeight;
    const pageHeight = document.documentElement.scrollHeight;

    // Calculate scroll depth percentage
    const scrollableHeight = pageHeight - viewportHeight;
    const scrollPercent =
      scrollableHeight > 0
        ? Math.min(100, Math.round((scrollTop / scrollableHeight) * 100))
        : 100;

    // Only track if we've crossed a threshold
    const roundedDepth = Math.floor(scrollPercent / this.threshold) * this.threshold;

    if (roundedDepth > this.lastTrackedDepth) {
      this.lastTrackedDepth = roundedDepth;
      this.maxDepth = Math.max(this.maxDepth, roundedDepth);

      this.addEvent({
        type: "scroll",
        scrollDepth: roundedDepth,
        scrollDepthPixels: Math.round(scrollTop + viewportHeight),
        pageHeight,
      });

      this.log("Scroll depth tracked:", roundedDepth + "%");
    }
  }

  /**
   * Gets the maximum scroll depth reached
   */
  getMaxDepth(): number {
    return this.maxDepth;
  }

  /**
   * Resets tracking for a new page
   */
  reset(): void {
    this.lastTrackedDepth = 0;
    this.maxDepth = 0;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("scroll", this.scrollHandler);
      window.removeEventListener("resize", this.scrollHandler);
    }
    this.log("Destroyed");
  }
}

// ============================================================================
// ERROR TRACKER
// ============================================================================

type ErrorTrackerConfig = BaseTrackerConfig;

/**
 * Tracks JavaScript errors
 */
export class ErrorTracker extends BaseTracker {
  private errorHandler: (event: ErrorEvent) => void;
  private unhandledRejectionHandler: (event: PromiseRejectionEvent) => void;

  constructor(config: ErrorTrackerConfig) {
    super(config);

    this.errorHandler = this.handleError.bind(this);
    this.unhandledRejectionHandler = this.handleUnhandledRejection.bind(this);
    this.attach();
  }

  private attach(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("error", this.errorHandler);
    window.addEventListener("unhandledrejection", this.unhandledRejectionHandler);

    this.log("Attached error listeners");
  }

  private handleError(event: ErrorEvent): void {
    if (this.destroyed) return;

    this.addEvent({
      type: "error",
      errorMessage: event.message,
      errorStack: event.error?.stack,
      errorType: event.error?.name || "Error",
      errorSource: event.filename,
      errorLine: event.lineno,
      errorColumn: event.colno,
    });

    this.log("Error tracked:", event.message);
  }

  private handleUnhandledRejection(event: PromiseRejectionEvent): void {
    if (this.destroyed) return;

    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
        ? reason
        : "Unhandled Promise Rejection";

    this.addEvent({
      type: "error",
      errorMessage: message,
      errorStack: reason instanceof Error ? reason.stack : undefined,
      errorType: reason instanceof Error ? reason.name : "UnhandledRejection",
    });

    this.log("Unhandled rejection tracked:", message);
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("error", this.errorHandler);
      window.removeEventListener("unhandledrejection", this.unhandledRejectionHandler);
    }
    this.log("Destroyed");
  }
}

// ============================================================================
// PAGE VIEW TRACKER
// ============================================================================

interface PageViewTrackerConfig extends BaseTrackerConfig {
  /** Callback when page changes */
  onPageChange?: (url: string) => void;
}

/**
 * Tracks page views
 * Works with Next.js App Router via MutationObserver or history API
 */
export class PageViewTracker extends BaseTracker {
  private lastUrl: string = "";
  private lastTitle: string = "";
  private pageStartTime: number = Date.now();
  private observer: MutationObserver | null = null;
  private popstateHandler: () => void;
  private onPageChange?: (url: string) => void;

  constructor(config: PageViewTrackerConfig) {
    super(config);
    this.onPageChange = config.onPageChange;

    this.popstateHandler = this.handlePopState.bind(this);
    this.attach();

    // Track initial page view
    this.trackPageView();
  }

  private attach(): void {
    if (typeof window === "undefined") return;

    // Listen for history navigation
    window.addEventListener("popstate", this.popstateHandler);

    // Patch pushState and replaceState for SPA navigation
    this.patchHistoryMethods();

    // Use MutationObserver as a fallback for title changes
    this.observeTitleChanges();

    this.log("Attached page view tracker");
  }

  private patchHistoryMethods(): void {
    if (typeof history === "undefined") return;

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      originalPushState(...args);
      this.handleNavigation();
    };

    history.replaceState = (...args) => {
      originalReplaceState(...args);
      this.handleNavigation();
    };
  }

  private observeTitleChanges(): void {
    if (typeof MutationObserver === "undefined") return;

    const titleElement = document.querySelector("title");
    if (!titleElement) return;

    this.observer = new MutationObserver(() => {
      // Title changed, might be a page navigation
      if (document.title !== this.lastTitle) {
        this.handleNavigation();
      }
    });

    this.observer.observe(titleElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  private handlePopState(): void {
    this.handleNavigation();
  }

  private handleNavigation(): void {
    // Small delay to let the page update
    setTimeout(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== this.lastUrl) {
        this.trackPageView();
      }
    }, 100);
  }

  private trackPageView(): void {
    if (this.destroyed) return;
    if (typeof window === "undefined") return;

    const currentUrl = window.location.href;
    const currentTitle = document.title;

    // Track time on previous page
    if (this.lastUrl) {
      const timeOnPage = Math.round((Date.now() - this.pageStartTime) / 1000);
      this.addEvent({
        type: "visibility_change",
        visibilityState: "hidden",
        timeOnPage,
      });
    }

    // Track new page view
    this.addEvent({
      type: "pageview",
      pageTitle: currentTitle,
      referrer: this.lastUrl || document.referrer,
    });

    this.lastUrl = currentUrl;
    this.lastTitle = currentTitle;
    this.pageStartTime = Date.now();

    this.onPageChange?.(currentUrl);
    this.log("Page view tracked:", currentUrl);
  }

  /**
   * Manually track a page view (for client-side routers)
   */
  trackManualPageView(url?: string): void {
    if (url) {
      this.lastUrl = url;
    }
    this.trackPageView();
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", this.popstateHandler);
    }
    if (this.observer) {
      this.observer.disconnect();
    }
    this.log("Destroyed");
  }
}

// ============================================================================
// VISIBILITY TRACKER
// ============================================================================

type VisibilityTrackerConfig = BaseTrackerConfig;

/**
 * Tracks page visibility changes
 */
export class VisibilityTracker extends BaseTracker {
  private visibilityHandler: () => void;
  private pageStartTime: number = Date.now();

  constructor(config: VisibilityTrackerConfig) {
    super(config);

    this.visibilityHandler = this.handleVisibilityChange.bind(this);
    this.attach();
  }

  private attach(): void {
    if (typeof document === "undefined") return;

    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.log("Attached visibility tracker");
  }

  private handleVisibilityChange(): void {
    if (this.destroyed) return;

    const state = document.visibilityState as "visible" | "hidden";
    const timeOnPage = Math.round((Date.now() - this.pageStartTime) / 1000);

    this.addEvent({
      type: "visibility_change",
      visibilityState: state,
      timeOnPage: state === "hidden" ? timeOnPage : undefined,
    });

    if (state === "visible") {
      this.pageStartTime = Date.now();
    }

    this.log("Visibility changed:", state);
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.log("Destroyed");
  }
}
