/**
 * Store (observable state) tests — getState, setState, subscribe,
 * immutable updates, listener dedup, batch updates, snapshot.
 */
import { jest } from "@jest/globals";
import { createStore } from "../../src/state/store.js";

// ---------------------------------------------------------------------------
// Types for testing
// ---------------------------------------------------------------------------

interface TestState {
  count: number;
  name: string;
  items: string[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Store — getState / setState", () => {
  it("returns the initial state", () => {
    const initialState: TestState = { count: 0, name: "test", items: [] };
    const store = createStore(initialState);
    expect(store.getState()).toEqual({ count: 0, name: "test", items: [] });
  });

  it("updates state via setState", () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    store.setState((prev) => ({ ...prev, count: 1 }));
    expect(store.getState().count).toBe(1);
  });

  it("can update multiple fields at once", () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    store.setState((prev) => ({
      ...prev,
      count: 5,
      name: "updated",
      items: ["a", "b"],
    }));
    const state = store.getState();
    expect(state.count).toBe(5);
    expect(state.name).toBe("updated");
    expect(state.items).toEqual(["a", "b"]);
  });

  it("supports primitive state (number)", () => {
    const store = createStore(42);
    expect(store.getState()).toBe(42);
    store.setState(() => 100);
    expect(store.getState()).toBe(100);
  });

  it("supports array state", () => {
    const store = createStore<string[]>(["a", "b"]);
    store.setState((prev) => [...prev, "c"]);
    expect(store.getState()).toEqual(["a", "b", "c"]);
  });
});

describe("Store — immutable updates", () => {
  it("returns a new object reference after update", () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const before = store.getState();
    store.setState((prev) => ({ ...prev, count: 1 }));
    const after = store.getState();
    expect(after).not.toBe(before);
  });

  it("does not mutate the previous state", () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const before = store.getState();
    store.setState((prev) => ({
      ...prev,
      items: [...prev.items, "new"],
    }));
    const after = store.getState();
    expect(before.items).toEqual([]);
    expect(after.items).toEqual(["new"]);
  });

  it("does not notify if updater returns identical reference", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener = jest.fn();

    store.subscribe(listener);
    store.setState((prev) => prev);
    store.setState((prev) => prev);

    // Wait for microtask batch
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("Store — subscribe", () => {
  it("calls listener on state change", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener = jest.fn();

    store.subscribe(listener);
    store.setState((prev) => ({ ...prev, count: 1 }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 0 }),
    );
  });

  it("delivers (newState, prevState) to listener", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener = jest.fn();

    store.subscribe(listener);
    store.setState((prev) => ({ ...prev, count: 5 }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const newState = listener.mock.calls[0][0] as TestState;
    const prevState = listener.mock.calls[0][1] as TestState;
    expect(newState.count).toBe(5);
    expect(prevState.count).toBe(0);
  });

  it("returns unsubscribe function that stops listener", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener = jest.fn();

    const unsub = store.subscribe(listener);
    unsub();

    store.setState((prev) => ({ ...prev, count: 1 }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple listeners", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener1 = jest.fn();
    const listener2 = jest.fn();

    store.subscribe(listener1);
    store.subscribe(listener2);
    store.setState((prev) => ({ ...prev, count: 1 }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("removes only the unsubscribed listener", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener1 = jest.fn();
    const listener2 = jest.fn();

    const unsub1 = store.subscribe(listener1);
    store.subscribe(listener2);

    unsub1();

    store.setState((prev) => ({ ...prev, count: 1 }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});

describe("Store — batch updates", () => {
  it("coalesces multiple synchronous setState calls into one notification", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener = jest.fn();

    store.subscribe(listener);

    store.setState((prev) => ({ ...prev, count: 1 }));
    store.setState((prev) => ({ ...prev, count: 2 }));
    store.setState((prev) => ({ ...prev, count: 3 }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).toHaveBeenCalledTimes(1);
    const newState = listener.mock.calls[0][0] as TestState;
    expect(newState.count).toBe(3);
  });

  it("reports prev state as the state before first batch update", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener = jest.fn();

    store.subscribe(listener);

    store.setState((prev) => ({ ...prev, count: 10 }));
    store.setState((prev) => ({ ...prev, count: 20 }));
    store.setState((prev) => ({ ...prev, count: 30 }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const prevState = listener.mock.calls[0][1] as TestState;
    expect(prevState.count).toBe(0);
  });

  it("getState returns current state immediately during batch", () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });

    store.setState((prev) => ({ ...prev, count: 1 }));
    expect(store.getState().count).toBe(1);

    store.setState((prev) => ({ ...prev, count: 2 }));
    expect(store.getState().count).toBe(2);
  });

  it("separate synchronous blocks trigger separate notifications", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener = jest.fn();

    store.subscribe(listener);

    store.setState((prev) => ({ ...prev, count: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    store.setState((prev) => ({ ...prev, count: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("Store — snapshot", () => {
  it("returns a deep clone of the current state", () => {
    const store = createStore<TestState>({
      count: 0,
      name: "test",
      items: ["a", "b"],
    });
    const snap = store.snapshot();

    expect(snap).toEqual(store.getState());
    expect(snap).not.toBe(store.getState());
    expect(snap.items).not.toBe(store.getState().items);
  });

  it("mutation of snapshot does not affect original state", () => {
    const store = createStore<TestState>({
      count: 0,
      name: "test",
      items: ["a", "b"],
    });
    const snap = store.snapshot();
    snap.count = 999;
    snap.items.push("malicious");

    const current = store.getState();
    expect(current.count).toBe(0);
    expect(current.items).toEqual(["a", "b"]);
  });

  it("handles null values in snapshot", () => {
    const store = createStore<{ data: string | null }>({ data: null });
    const snap = store.snapshot();
    expect(snap.data).toBeNull();
  });
});

describe("Store — edge cases", () => {
  it("handles no-op setState gracefully", () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    store.setState((prev) => prev);
    expect(store.getState().count).toBe(0);
  });

  it("handles rapid consecutive state transitions", async () => {
    const store = createStore<TestState>({ count: 0, name: "test", items: [] });
    const listener = jest.fn();

    store.subscribe(listener);

    store.setState((prev) => ({ ...prev, count: 1 }));
    store.setState((prev) => ({ ...prev, count: 2 }));
    store.setState((prev) => ({ ...prev, count: 3 }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).toHaveBeenCalledTimes(1);
    const finalState = listener.mock.calls[0][0] as TestState;
    expect(finalState.count).toBe(3);
  });

  it("handles large state objects", () => {
    const largeItems = Array.from({ length: 1000 }, (_, i) => `item-${i}`);
    const store = createStore<TestState>({
      count: 0,
      name: "large",
      items: largeItems,
    });
    expect(store.getState().items.length).toBe(1000);

    store.setState((prev) => ({ ...prev, items: [...prev.items, "new"] }));
    expect(store.getState().items.length).toBe(1001);
  });

  it("stores contain independent state (no cross-contamination)", async () => {
    const store1 = createStore({ value: "a" });
    const store2 = createStore({ value: "x" });

    const listener1 = jest.fn();
    const listener2 = jest.fn();

    store1.subscribe(listener1);
    store2.subscribe(listener2);

    store1.setState((prev) => ({ ...prev, value: "b" }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).not.toHaveBeenCalled();
    expect(store2.getState().value).toBe("x");
  });
});
