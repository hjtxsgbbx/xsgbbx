// Electron Desktop Performance Utilities
// Used by renderer process for virtual scrolling, lazy loading, and Web Workers

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      fn(...args);
    }
  };
}

export function rafThrottle<T extends (...args: unknown[]) => void>(
  fn: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null;
  return (...args: Parameters<T>) => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      fn(...args);
      rafId = null;
    });
  };
}

export function useIdleCallback<T extends (...args: unknown[]) => void>(
  fn: T
): (...args: Parameters<T>) => void {
  return (...args: Parameters<T>) => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => fn(...args));
    } else {
      setTimeout(() => fn(...args), 1);
    }
  };
}

export interface VirtualListConfig {
  itemHeight: number;
  containerHeight: number;
  totalItems: number;
  overscan: number;
}

export function computeVisibleRange(
  scrollTop: number,
  config: VirtualListConfig
): { start: number; end: number; offset: number } {
  const { itemHeight, containerHeight, totalItems, overscan } = config;
  const visibleStart = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(containerHeight / itemHeight);

  const start = Math.max(0, visibleStart - overscan);
  const end = Math.min(totalItems, visibleStart + visibleCount + overscan);
  const offset = start * itemHeight;

  return { start, end, offset };
}

export class TypedEmitter<T extends Record<string, (...args: never[]) => void>> {
  private listeners = new Map<string, Set<(...args: never[]) => void>>();

  on<K extends keyof T & string>(event: K, handler: T[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (...args: never[]) => void);
  }

  off<K extends keyof T & string>(event: K, handler: T[K]): void {
    this.listeners.get(event)?.delete(handler as (...args: never[]) => void);
  }

  emit<K extends keyof T & string>(event: K, ...args: Parameters<T[K]>): void {
    this.listeners.get(event)?.forEach((handler) => handler(...args));
  }

  clear(): void {
    this.listeners.clear();
  }
}