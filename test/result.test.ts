import { fromPromise, fromThrowable, ok, err, match, unwrapOr, mapResult, Result } from "../src/common/result.js";

describe("Result type", () => {
  test("ok creates success result", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test("err creates error result", () => {
    const result = err(new Error("boom"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("boom");
    }
  });

  test("fromThrowable wraps sync throws", () => {
    const success = fromThrowable(() => "hello");
    expect(success.ok).toBe(true);

    const failure = fromThrowable(() => {
      throw new Error("fail");
    });
    expect(failure.ok).toBe(false);
  });

  test("fromPromise wraps async throws", async () => {
    const success = await fromPromise(Promise.resolve("async"));
    expect(success.ok).toBe(true);

    const failure = await fromPromise(Promise.reject(new Error("async fail")));
    expect(failure.ok).toBe(false);
  });

  test("match branches correctly", () => {
    const success = ok(10);
    const fail = err("err");

    const sResult = match(success, (v) => `got ${v}`, (e) => `error ${e}`);
    expect(sResult).toBe("got 10");

    const fResult = match(fail, (v) => `got ${v}`, (e) => `error ${e}`);
    expect(fResult).toBe("error err");
  });

  test("unwrapOr provides default on error", () => {
    expect(unwrapOr(ok("a"), "default")).toBe("a");
    expect(unwrapOr(err("oops"), "default")).toBe("default");
  });

  test("mapResult transforms success values", () => {
    const doubled = mapResult(ok(5), (v) => v * 2);
    expect(doubled.ok && doubled.value).toBe(10);

    const unchanged = mapResult(err("no"), (v: unknown) => v);
    expect(unchanged.ok).toBe(false);
  });
});