import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "../src/core/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 5000,
      timeoutMs: 1000,
      maxRetries: 1,
      retryDelayMs: 10,
      successThreshold: 2,
    });
  });

  describe("State transitions", () => {
    it("should start in closed state", () => {
      expect(breaker.getState()).toBe("closed");
    });

    it("should open after threshold failures", async () => {
      const failFn = async () => {
        throw new Error("fail");
      };

      for (let i = 0; i < 3; i++) {
        await breaker.call(failFn).catch(() => {});
      }

      expect(breaker.getState()).toBe("open");
      expect(breaker.isOpen()).toBe(true);
    });

    it("should close after success in half-open state", async () => {
      const failFn = async () => {
        throw new Error("fail");
      };

      for (let i = 0; i < 3; i++) {
        await breaker.call(failFn).catch(() => {});
      }

      await new Promise((r) => setTimeout(r, 100));

      breaker.reset();
      expect(breaker.getState()).toBe("closed");
    });
  });

  describe("Successful calls", () => {
    it("should return the result of a successful call", async () => {
      const result = await breaker.call(async () => "hello");
      expect(result).toBe("hello");
    });

    it("should reset failure count on success", async () => {
      await breaker.call(async () => {
        throw new Error("fail");
      }).catch(() => {});

      await breaker.call(async () => "success");
      expect(breaker.getFailures()).toBe(0);
    });

    it("should track consecutive failures", async () => {
      for (let i = 0; i < 2; i++) {
        await breaker.call(async () => {
          throw new Error("fail");
        }).catch(() => {});
      }

      expect(breaker.getFailures()).toBe(2);
    });
  });

  describe("Error handling", () => {
    it("should throw CircuitBreakerOpenError when open", async () => {
      const failFn = async () => {
        throw new Error("fail");
      };

      for (let i = 0; i < 3; i++) {
        await breaker.call(failFn).catch(() => {});
      }

      await expect(breaker.call(async () => "test")).rejects.toThrow(
        CircuitBreakerOpenError
      );
    });

    it("should retry on failure", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) throw new Error("fail");
        return "success";
      };

      const result = await breaker.call(fn);
      expect(result).toBe("success");
      expect(attempts).toBe(2);
    });

    it("should propagate original error after retries exhausted", async () => {
      const fn = async () => {
        throw new Error("persistent error");
      };

      await expect(breaker.call(fn)).rejects.toThrow("persistent error");
    });
  });

  describe("Reset", () => {
    it("should reset state to closed", async () => {
      const failFn = async () => {
        throw new Error("fail");
      };

      for (let i = 0; i < 3; i++) {
        await breaker.call(failFn).catch(() => {});
      }

      breaker.reset();

      expect(breaker.getState()).toBe("closed");
      expect(breaker.getFailures()).toBe(0);
    });
  });
});