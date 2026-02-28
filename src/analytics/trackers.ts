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
  /** Enable rage-click detection */
  detectRageClicks?: boolean;
  /** Number of clicks required to trigger rage-click detection */
  rageClickThreshold?: number;
  /** Time window in ms for rage-click detection */
  rageClickWindow?: number;
  /** Pixel radius for rage-click proximity detection */
  rageClickRadius?: number;
}

/**
 * Interface for tracking recent clicks for rage-click detection
 */
interface RecentClick {
  x: number;
  y: number;
  timestamp: number;
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
 * Calculate Euclidean distance between two points
 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

/**
 * Tracks click events for heatmaps and detects rage clicks
 */
export class ClickTracker extends BaseTracker {
  private clickHandler: (event: MouseEvent) => void;
  private ignoredSelectors: string[];

  // Rage-click detection
  private detectRageClicks: boolean;
  private rageClickThreshold: number;
  private rageClickWindow: number;
  private rageClickRadius: number;
  private recentClicks: RecentClick[] = [];
  private currentRageClickSequence: number = 0;
  private inRageClickSequence: boolean = false;

  constructor(config: ClickTrackerConfig) {
    super(config);
    this.ignoredSelectors = config.ignoredElements ?? [];

    // Rage-click detection configuration
    this.detectRageClicks = config.detectRageClicks ?? true;
    this.rageClickThreshold = config.rageClickThreshold ?? 3;
    this.rageClickWindow = config.rageClickWindow ?? 1000;
    this.rageClickRadius = config.rageClickRadius ?? 50;

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

    // Detect rage clicks
    let isRageClick = false;
    let rageClickSequence: number | undefined;

    if (this.detectRageClicks) {
      const rageClickInfo = this.detectRageClick(x, y);
      isRageClick = rageClickInfo.isRageClick;
      rageClickSequence = rageClickInfo.sequence;
    }

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
      isRageClick: isRageClick || undefined,
      rageClickSequence,
    });

    this.log("Click tracked:", target.tagName, x, y, isRageClick ? "(rage click)" : "");
  }

  /**
   * Detects if the current click is part of a rage-click sequence
   */
  private detectRageClick(x: number, y: number): { isRageClick: boolean; sequence?: number } {
    const now = Date.now();

    // Add current click to recent clicks
    this.recentClicks.push({ x, y, timestamp: now });

    // Remove clicks outside the time window
    this.recentClicks = this.recentClicks.filter(
      (click) => now - click.timestamp <= this.rageClickWindow
    );

    // Check if we have enough clicks within the time window
    if (this.recentClicks.length < this.rageClickThreshold) {
      this.inRageClickSequence = false;
      this.currentRageClickSequence = 0;
      return { isRageClick: false };
    }

    // Check if all recent clicks are within the proximity radius
    const firstClick = this.recentClicks[0];
    const allNearby = this.recentClicks.every(
      (click) => distance(firstClick.x, firstClick.y, click.x, click.y) <= this.rageClickRadius
    );

    if (allNearby) {
      // This is a rage click
      if (!this.inRageClickSequence) {
        // Start of a new rage-click sequence
        this.inRageClickSequence = true;
        this.currentRageClickSequence = this.recentClicks.length;
      } else {
        // Continue the sequence
        this.currentRageClickSequence++;
      }

      this.log("Rage click detected! Sequence:", this.currentRageClickSequence);
      return { isRageClick: true, sequence: this.currentRageClickSequence };
    }

    // Not a rage click
    this.inRageClickSequence = false;
    this.currentRageClickSequence = 0;
    return { isRageClick: false };
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
  /** Enable continuous sampling for scroll heatmaps (default true) */
  enableHeatmapSampling?: boolean;
  /** Interval for heatmap sampling in ms (default 200) */
  heatmapSampleInterval?: number;
}

/**
 * Tracks scroll depth for analytics and generates scroll heatmap data
 */
export class ScrollTracker extends BaseTracker {
  private scrollHandler: () => void;
  private threshold: number;
  private lastTrackedDepth: number = 0;
  private maxDepth: number = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Scroll heatmap sampling
  private enableHeatmapSampling: boolean;
  private heatmapSampleInterval: number;
  private heatmapSampleTimer: ReturnType<typeof setInterval> | null = null;
  private scrollHeatmapGrid: number[] = new Array(100).fill(0);
  private lastSampleTime: number = 0;

  constructor(config: ScrollTrackerConfig) {
    super(config);
    this.threshold = config.threshold ?? 25;
    this.enableHeatmapSampling = config.enableHeatmapSampling ?? true;
    this.heatmapSampleInterval = config.heatmapSampleInterval ?? 200;

    this.scrollHandler = this.handleScroll.bind(this);
    this.attach();

    // Start heatmap sampling if enabled
    if (this.enableHeatmapSampling) {
      this.startHeatmapSampling();
    }
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
   * Starts continuous sampling for scroll heatmap generation
   */
  private startHeatmapSampling(): void {
    if (typeof window === "undefined") return;

    this.heatmapSampleTimer = setInterval(() => {
      this.sampleScrollPosition();
    }, this.heatmapSampleInterval);

    // Sample immediately
    this.sampleScrollPosition();
    this.log("Started heatmap sampling");
  }

  /**
   * Samples the current scroll position and updates the heatmap grid.
   * The grid represents which portions of the page are visible at each sample.
   */
  private sampleScrollPosition(): void {
    if (this.destroyed || typeof window === "undefined") return;

    const now = Date.now();
    // Prevent duplicate samples
    if (now - this.lastSampleTime < this.heatmapSampleInterval * 0.8) return;
    this.lastSampleTime = now;

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const viewportHeight = window.innerHeight;
    const pageHeight = document.documentElement.scrollHeight;

    if (pageHeight <= 0) return;

    // Calculate which portion of the page is currently visible
    const viewportTopPercent = Math.max(0, Math.min(100, (scrollTop / pageHeight) * 100));
    const viewportBottomPercent = Math.max(0, Math.min(100, ((scrollTop + viewportHeight) / pageHeight) * 100));

    // Convert to grid indices (0-99)
    const startIndex = Math.floor(viewportTopPercent);
    const endIndex = Math.min(99, Math.ceil(viewportBottomPercent));

    // Increment all visible grid positions
    for (let i = startIndex; i <= endIndex; i++) {
      this.scrollHeatmapGrid[i]++;
    }
  }

  /**
   * Gets the maximum scroll depth reached
   */
  getMaxDepth(): number {
    return this.maxDepth;
  }

  /**
   * Gets the scroll heatmap grid (100 values representing view counts at each position)
   */
  getScrollHeatmapGrid(): number[] {
    return [...this.scrollHeatmapGrid];
  }

  /**
   * Gets scroll heatmap metrics including the grid and computed stats
   */
  getScrollHeatmapMetrics(): {
    grid: number[];
    maxDepth: number;
    avgDepth: number;
    totalSamples: number;
  } {
    const grid = this.getScrollHeatmapGrid();
    const totalSamples = Math.max(1, grid[0]); // First position always viewed

    // Calculate average depth based on where users actually scrolled
    let weightedSum = 0;
    let maxViewedPosition = 0;

    for (let i = 0; i < 100; i++) {
      if (grid[i] > 0) {
        weightedSum += i * grid[i];
        maxViewedPosition = i;
      }
    }

    const avgDepth = grid.reduce((sum, v) => sum + v, 0) > 0
      ? Math.round(weightedSum / grid.reduce((sum, v) => sum + v, 0))
      : 0;

    return {
      grid,
      maxDepth: maxViewedPosition,
      avgDepth,
      totalSamples,
    };
  }

  /**
   * Resets tracking for a new page
   */
  reset(): void {
    this.lastTrackedDepth = 0;
    this.maxDepth = 0;
    this.scrollHeatmapGrid = new Array(100).fill(0);
    this.lastSampleTime = 0;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.heatmapSampleTimer) {
      clearInterval(this.heatmapSampleTimer);
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

// ============================================================================
// MOVEMENT TRACKER (Mouse Movement Heatmaps)
// ============================================================================

interface MovementTrackerConfig extends BaseTrackerConfig {
  /** Minimum interval between samples in ms (default 100) */
  sampleInterval?: number;
  /** Track attention time on elements (default true) */
  trackAttention?: boolean;
  /** CSS selectors for elements to track attention on */
  attentionSelectors?: string[];
}

/**
 * Tracks mouse movement for heatmaps and attention analysis
 */
export class MovementTracker extends BaseTracker {
  private moveHandler: (event: MouseEvent) => void;
  private sampleInterval: number;
  private lastSampleTime: number = 0;

  // Movement grid (100x100 = 10000 positions)
  private movementGrid: number[] = new Array(10000).fill(0);
  private positionBuffer: Array<{ x: number; y: number }> = [];

  // Attention tracking
  private trackAttention: boolean;
  private attentionSelectors: string[];
  private attentionTime: Map<string, number> = new Map();
  private currentHoveredElement: { selector: string; startTime: number } | null = null;
  private mouseoverHandler: (event: MouseEvent) => void;
  private mouseoutHandler: (event: MouseEvent) => void;

  // Flush interval for batched updates
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: MovementTrackerConfig) {
    super(config);
    this.sampleInterval = config.sampleInterval ?? 100;
    this.trackAttention = config.trackAttention ?? true;
    this.attentionSelectors = config.attentionSelectors ?? [
      "button",
      "a",
      "input",
      "select",
      "textarea",
      "[data-track-attention]",
      ".cta",
      ".btn",
    ];

    this.moveHandler = this.handleMouseMove.bind(this);
    this.mouseoverHandler = this.handleMouseOver.bind(this);
    this.mouseoutHandler = this.handleMouseOut.bind(this);

    this.attach();
  }

  private attach(): void {
    if (typeof document === "undefined") return;

    document.addEventListener("mousemove", this.moveHandler, { passive: true });

    if (this.trackAttention) {
      document.addEventListener("mouseover", this.mouseoverHandler, { passive: true });
      document.addEventListener("mouseout", this.mouseoutHandler, { passive: true });
    }

    // Flush position buffer periodically
    this.flushInterval = setInterval(() => {
      this.flushPositionBuffer();
    }, 5000);

    this.log("Attached movement tracker");
  }

  private handleMouseMove(event: MouseEvent): void {
    if (this.destroyed) return;

    const now = Date.now();
    // Throttle sampling
    if (now - this.lastSampleTime < this.sampleInterval) return;
    this.lastSampleTime = now;

    // Calculate position as percentage of viewport
    const xPercent = Math.round((event.clientX / window.innerWidth) * 100);
    const yPercent = Math.round((event.clientY / window.innerHeight) * 100);

    // Clamp to valid range
    const x = Math.max(0, Math.min(99, xPercent));
    const y = Math.max(0, Math.min(99, yPercent));

    // Add to buffer
    this.positionBuffer.push({ x, y });

    // Update grid immediately
    const gridIndex = y * 100 + x;
    this.movementGrid[gridIndex]++;
  }

  private handleMouseOver(event: MouseEvent): void {
    if (this.destroyed || !this.trackAttention) return;

    const target = event.target as Element;
    if (!target) return;

    // Check if this element matches any attention selectors
    const matchedSelector = this.findMatchingSelector(target);
    if (matchedSelector) {
      // End tracking on previous element if any
      this.endCurrentAttentionTracking();

      // Start tracking new element
      this.currentHoveredElement = {
        selector: matchedSelector,
        startTime: Date.now(),
      };
    }
  }

  private handleMouseOut(event: MouseEvent): void {
    if (this.destroyed || !this.trackAttention) return;

    const target = event.target as Element;
    if (!target) return;

    // Only end tracking if we're leaving a tracked element
    const matchedSelector = this.findMatchingSelector(target);
    if (matchedSelector && this.currentHoveredElement?.selector === matchedSelector) {
      this.endCurrentAttentionTracking();
    }
  }

  private findMatchingSelector(element: Element): string | null {
    for (const selector of this.attentionSelectors) {
      try {
        if (element.matches(selector)) {
          // Generate a more specific selector for this element
          return generateSelector(element);
        }
        // Check parent elements
        const parent = element.closest(selector);
        if (parent) {
          return generateSelector(parent);
        }
      } catch {
        // Invalid selector, skip
      }
    }
    return null;
  }

  private endCurrentAttentionTracking(): void {
    if (this.currentHoveredElement) {
      const duration = (Date.now() - this.currentHoveredElement.startTime) / 1000; // Convert to seconds
      const selector = this.currentHoveredElement.selector;

      // Accumulate attention time
      const existing = this.attentionTime.get(selector) || 0;
      this.attentionTime.set(selector, existing + duration);

      this.currentHoveredElement = null;
    }
  }

  /**
   * Flushes the position buffer (for potential network transmission)
   */
  private flushPositionBuffer(): void {
    if (this.positionBuffer.length === 0) return;

    // In the future, this could batch-send positions to the server
    // For now, we just clear the buffer as positions are already in the grid
    this.positionBuffer = [];
  }

  /**
   * Gets the movement heatmap grid (10000 values for 100x100 grid)
   */
  getMovementGrid(): number[] {
    return [...this.movementGrid];
  }

  /**
   * Gets attention time per element (selector -> seconds)
   */
  getAttentionTime(): Record<string, number> {
    // End any current tracking before returning
    this.endCurrentAttentionTracking();

    const result: Record<string, number> = {};
    this.attentionTime.forEach((time, selector) => {
      result[selector] = Math.round(time * 10) / 10; // Round to 1 decimal
    });
    return result;
  }

  /**
   * Gets movement heatmap metrics
   */
  getMovementMetrics(): {
    grid: number[];
    attentionTime: Record<string, number>;
    totalSamples: number;
    hotspots: Array<{ x: number; y: number; intensity: number }>;
  } {
    const grid = this.getMovementGrid();
    const totalSamples = grid.reduce((sum, v) => sum + v, 0);

    // Find hotspots (top 10 grid cells by intensity)
    const hotspots: Array<{ x: number; y: number; intensity: number }> = [];
    const maxValue = Math.max(...grid);

    if (maxValue > 0) {
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] > maxValue * 0.5) { // Only include cells with >50% of max intensity
          hotspots.push({
            x: i % 100,
            y: Math.floor(i / 100),
            intensity: Math.round((grid[i] / maxValue) * 100),
          });
        }
      }
      // Sort by intensity and take top 10
      hotspots.sort((a, b) => b.intensity - a.intensity);
      hotspots.splice(10);
    }

    return {
      grid,
      attentionTime: this.getAttentionTime(),
      totalSamples,
      hotspots,
    };
  }

  /**
   * Resets tracking for a new page
   */
  reset(): void {
    this.movementGrid = new Array(10000).fill(0);
    this.positionBuffer = [];
    this.attentionTime.clear();
    this.currentHoveredElement = null;
    this.lastSampleTime = 0;
  }

  destroy(): void {
    this.destroyed = true;

    // End any current attention tracking
    this.endCurrentAttentionTracking();

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    if (typeof document !== "undefined") {
      document.removeEventListener("mousemove", this.moveHandler);
      document.removeEventListener("mouseover", this.mouseoverHandler);
      document.removeEventListener("mouseout", this.mouseoutHandler);
    }
    this.log("Destroyed");
  }
}
