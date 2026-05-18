import { type ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";

interface ManagedProcess {
  child: ChildProcess;
  id: string;
  command: string;
  startedAt: number;
  timeoutMs: number;
}

export class ProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();
  private shutdownRequested = false;
  private nextId = 1;
  private cleanupFn: (() => void) | null = null;
  private exitFn: (() => void) | null = null;
  private exceptionFn: ((err: Error) => void) | null = null;

  constructor() {
    super();
    this.setMaxListeners(20);
    this.registerShutdownHandlers();
  }

  private registerShutdownHandlers(): void {
    this.cleanupFn = () => {
      this.shutdownRequested = true;
      this.killAll("SIGTERM");

      setTimeout(() => {
        this.killAll("SIGKILL");
        process.exit(0);
      }, 3000);
    };

    this.exitFn = () => {
      this.killAll("SIGKILL");
    };

    this.exceptionFn = (err: Error) => {
      console.error("Uncaught exception, cleaning up child processes:", err.message);
      this.killAll("SIGTERM");
    };

    process.on("SIGINT", this.cleanupFn);
    process.on("SIGTERM", this.cleanupFn);
    process.on("SIGHUP", this.cleanupFn);
    process.on("exit", this.exitFn);
    process.on("uncaughtException", this.exceptionFn);
  }

  spawn(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      timeoutMs?: number;
      env?: Record<string, string>;
      label?: string;
    }
  ): { child: ChildProcess; id: string } {
    if (this.shutdownRequested) {
      throw new Error("Shutdown in progress, refusing to spawn new process");
    }

    const id = `proc-${this.nextId++}`;

    const child = spawn(command, args, {
      cwd: options?.cwd || process.cwd(),
      env: { ...process.env, ...options?.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: options?.timeoutMs || 300000,
    });

    const managed: ManagedProcess = {
      child,
      id,
      command: options?.label || `${command} ${args.join(" ")}`,
      startedAt: Date.now(),
      timeoutMs: options?.timeoutMs || 300000,
    };

    this.processes.set(id, managed);

    if (options?.timeoutMs) {
      setTimeout(() => {
        const proc = this.processes.get(id);
        if (proc) {
          try {
            proc.child.kill("SIGTERM");
            setTimeout(() => {
              try { proc.child.kill("SIGKILL"); } catch { /* noop */ }
            }, 3000);
          } catch { /* noop */ }
        }
      }, options.timeoutMs);
    }

    child.on("exit", (code, signal) => {
      this.processes.delete(id);
      this.emit("process-exit", { id, code, signal, command: managed.command });

      if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL") {
        this.emit("process-error", {
          id,
          code,
          signal,
          command: managed.command,
        });
      }
    });

    child.on("error", (err) => {
      this.processes.delete(id);
      this.emit("process-error", {
        id,
        error: err.message,
        command: managed.command,
      });
    });

    return { child, id };
  }

  kill(id: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
    const proc = this.processes.get(id);
    if (!proc) return false;

    try {
      proc.child.kill(signal);
      return true;
    } catch {
      this.processes.delete(id);
      return false;
    }
  }

  killAll(signal: NodeJS.Signals = "SIGTERM"): void {
    const ids = [...this.processes.keys()];
    for (const id of ids) {
      const proc = this.processes.get(id);
      if (proc) {
        try {
          proc.child.kill(signal);
        } catch {
          this.processes.delete(id);
        }
      }
    }
    setTimeout(() => {
      for (const id of ids) {
        const proc = this.processes.get(id);
        if (proc) {
          try {
            proc.child.kill("SIGKILL");
          } catch {
            this.processes.delete(id);
          }
        }
      }
    }, 2000);
  }

  getActiveCount(): number {
    return this.processes.size;
  }

  getActiveProcesses(): Array<{ id: string; command: string; runningMs: number }> {
    const now = Date.now();
    return [...this.processes.values()].map((p) => ({
      id: p.id,
      command: p.command,
      runningMs: now - p.startedAt,
    }));
  }

  cleanup(): void {
    this.killAll("SIGKILL");
    this.processes.clear();
  }

  dispose(): void {
    this.cleanup();
    this.removeAllListeners();
    if (this.cleanupFn) {
      (process as unknown as EventEmitter).removeListener("SIGINT", this.cleanupFn);
      (process as unknown as EventEmitter).removeListener("SIGTERM", this.cleanupFn);
      (process as unknown as EventEmitter).removeListener("SIGHUP", this.cleanupFn);
      this.cleanupFn = null;
    }
    if (this.exitFn) {
      (process as unknown as EventEmitter).removeListener("exit", this.exitFn);
      this.exitFn = null;
    }
    if (this.exceptionFn) {
      (process as unknown as EventEmitter).removeListener("uncaughtException", this.exceptionFn);
      this.exceptionFn = null;
    }
  }
}

export const processManager = new ProcessManager();