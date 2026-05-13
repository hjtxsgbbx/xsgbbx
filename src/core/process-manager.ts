import { ChildProcess, spawn } from "child_process";
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

  constructor() {
    super();
    this.registerShutdownHandlers();
  }

  private registerShutdownHandlers(): void {
    const cleanup = () => {
      this.shutdownRequested = true;
      this.killAll("SIGTERM");

      setTimeout(() => {
        this.killAll("SIGKILL");
        process.exit(0);
      }, 3000);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("SIGHUP", cleanup);

    process.on("exit", () => {
      this.killAll("SIGKILL");
    });

    process.on("uncaughtException", (err) => {
      console.error("Uncaught exception, cleaning up child processes:", err.message);
      this.killAll("SIGTERM");
    });
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
              try { proc.child.kill("SIGKILL"); } catch {}
            }, 3000);
          } catch {}
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
    for (const [id, proc] of this.processes) {
      try {
        proc.child.kill(signal);
      } catch {
        this.processes.delete(id);
      }
    }
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
  }
}

export const processManager = new ProcessManager();