import { ProcessManager } from "../src/core/process-manager.js";

describe("ProcessManager", () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager();
  });

  afterEach(() => {
    pm.dispose();
  });

  describe("spawn", () => {
    it("should spawn a process and return id", () => {
      const { id, child } = pm.spawn("node", ["-e", "setTimeout(() => {}, 100)"]);
      expect(id).toMatch(/^proc-/);
      expect(child).toBeDefined();
      expect(typeof child.kill).toBe("function");
    });

    it("should track spawned process count", () => {
      pm.spawn("node", ["-e", "setTimeout(() => {}, 200)"]);
      expect(pm.getActiveCount()).toBe(1);
    });

    it("should emit process-exit on completion", (done) => {
      pm.on("process-exit", (info) => {
        expect(info.code).toBe(0);
        expect(info.command).toContain("exit-test");
        done();
      });

      pm.spawn("node", ["-e", ""], { label: "exit-test" });
    });

    it("should emit process-error on non-zero exit", (done) => {
      pm.on("process-error", (info) => {
        expect(info.code).toBe(1);
        done();
      });

      pm.spawn("node", ["-e", "process.exit(1)"], { timeoutMs: 5000 });
    });

    it("should emit process-error on spawn error", (done) => {
      pm.on("process-error", (info) => {
        expect(info.error).toBeDefined();
        done();
      });

      pm.spawn("nonexistent-command-xyz", [], { timeoutMs: 3000 });
    });
  });

  describe("kill", () => {
    it("should kill a running process", (done) => {
      const { id } = pm.spawn("node", ["-e", "setTimeout(() => {}, 10000)"]);
      expect(pm.getActiveCount()).toBe(1);
      const killed = pm.kill(id);
      expect(killed).toBe(true);
      setTimeout(() => {
        expect(pm.getActiveCount()).toBe(0);
        done();
      }, 100);
    });

    it("should return false for unknown process", () => {
      const killed = pm.kill("nonexistent-id");
      expect(killed).toBe(false);
    });
  });

  describe("killAll", () => {
    it("should kill all processes", (done) => {
      pm.spawn("node", ["-e", "setTimeout(() => {}, 10000)"]);
      pm.spawn("node", ["-e", "setTimeout(() => {}, 10000)"]);
      expect(pm.getActiveCount()).toBe(2);

      pm.killAll();
      setTimeout(() => {
        expect(pm.getActiveCount()).toBe(0);
        done();
      }, 100);
    });
  });

  describe("getActiveCount", () => {
    it("should return 0 initially", () => {
      expect(pm.getActiveCount()).toBe(0);
    });
  });

  describe("getActiveProcesses", () => {
    it("should list active processes", () => {
      pm.spawn("node", ["-e", "setTimeout(() => {}, 500)"], { label: "test-a" });
      pm.spawn("node", ["-e", "setTimeout(() => {}, 500)"], { label: "test-b" });

      const active = pm.getActiveProcesses();
      expect(active).toHaveLength(2);
      const commands = active.map((p) => p.command);
      expect(commands).toContain("test-a");
      expect(commands).toContain("test-b");
      expect(active[0].runningMs).toBeGreaterThanOrEqual(0);
    });

    it("should return empty array when no processes", () => {
      expect(pm.getActiveProcesses()).toEqual([]);
    });
  });

  describe("cleanup", () => {
    it("should kill all processes and clear tracking", () => {
      pm.spawn("node", ["-e", "setTimeout(() => {}, 10000)"]);
      pm.cleanup();
      expect(pm.getActiveCount()).toBe(0);
    });
  });

  describe("timeout", () => {
    it("should kill process after timeout", (done) => {
      pm.on("process-exit", () => {
        expect(pm.getActiveCount()).toBe(0);
        done();
      });

      pm.spawn("node", ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 200 });
    }, 5000);
  });
});