export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function fromThrowable<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export function match<T, E, R>(
  result: Result<T, E>,
  onOk: (value: T) => R,
  onErr: (error: E) => R
): R {
  if (result.ok) {
    return onOk(result.value);
  }
  return onErr(result.error);
}

export function unwrapOr<T>(result: Result<T, unknown>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

export function mapResult<T, U, E = Error>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return err(result.error);
}

export class WrappedError extends Error {
  constructor(
    message: string,
    public override cause?: Error & { code?: string }
  ) {
    super(message, { cause });
    this.name = "WrappedError";
  }
}

export function ensureError(err: unknown, context?: string): Error {
  if (err instanceof Error) {
    if (context) {
      return new WrappedError(`${context}: ${err.message}`, err);
    }
    return err;
  }
  const message = context
    ? `${context}: ${String(err)}`
    : String(err);
  return new Error(message);
}