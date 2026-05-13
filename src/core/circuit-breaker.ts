export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  cooldownMs: number;
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  cooldownMs: 30000,
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 60000,
};

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private lastSuccessTime = 0;
  private nextAttemptTime = 0;
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      const now = Date.now();
      if (now >= this.nextAttemptTime) {
        this.state = "half-open";
      } else {
        const remaining = Math.ceil((this.nextAttemptTime - now) / 1000);
        throw new CircuitBreakerOpenError(
          `Circuit breaker is open. Retry in ${remaining}s. Failures: ${this.failures}`
        );
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.executeWithTimeout(fn);

        if (this.state === "half-open") {
          this.successes++;
          if (this.successes >= this.config.successThreshold) {
            this.reset();
          }
        } else {
          this.failures = 0;
          this.lastSuccessTime = Date.now();
        }

        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.config.failureThreshold && this.state === "closed") {
      this.state = "open";
      this.nextAttemptTime = Date.now() + this.config.cooldownMs;
    }

    if (this.state === "half-open") {
      this.state = "open";
      this.nextAttemptTime = Date.now() + this.config.cooldownMs;
    }

    throw lastError || new Error("Circuit breaker call failed");
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }

  isOpen(): boolean {
    return this.state === "open";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

export const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  cooldownMs: 30000,
  maxRetries: 2,
  retryDelayMs: 2000,
  timeoutMs: 120000,
});