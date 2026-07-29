/**
 * Coalesce runtime-only work until the next animation frame.
 *
 * It deliberately does not know about descriptor deployment, networking, or a specific
 * renderer. A host may enqueue one `batch.commit()` per logical layer and make rendering
 * demand-driven separately.
 */
function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(Date.now()), 16);
}

function defaultCancelFrame(handle) {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle);
}

/**
 * @param {{
 *   requestFrame?: (callback: (now: number) => void) => unknown,
 *   cancelFrame?: (handle: unknown) => void,
 *   onError?: (error: unknown, key: unknown) => void
 * }} [options]
 */
export function createFrameCommitScheduler(options = {}) {
  const requestFrame = typeof options.requestFrame === "function" ? options.requestFrame : defaultRequestFrame;
  const cancelFrame = typeof options.cancelFrame === "function" ? options.cancelFrame : defaultCancelFrame;
  const onError = typeof options.onError === "function" ? options.onError : null;
  let pendingHandle = null;
  let disposed = false;
  /** @type {Map<unknown, () => unknown>} */
  let pendingJobs = new Map();
  let lastErrors = [];

  function requestFlush() {
    if (disposed || pendingHandle !== null || pendingJobs.size === 0) {
      return;
    }
    pendingHandle = requestFrame(flush);
  }

  function enqueue(key, job) {
    if (disposed) {
      throw new Error("FrameCommitScheduler: scheduler has been disposed");
    }
    if (typeof job !== "function") {
      throw new Error("FrameCommitScheduler: job must be a function");
    }
    pendingJobs.set(key, job);
    requestFlush();
    return pendingJobs.size;
  }

  function flush(now = Date.now()) {
    if (disposed) {
      return { now, executed: 0, errors: [] };
    }
    pendingHandle = null;
    const jobs = pendingJobs;
    pendingJobs = new Map();
    const errors = [];
    let executed = 0;
    for (const [key, job] of jobs) {
      try {
        job(now);
        executed += 1;
      } catch (error) {
        errors.push({ key, error });
        onError?.(error, key);
      }
    }
    lastErrors = errors;
    requestFlush();
    return { now, executed, errors };
  }

  function cancel({ clear = false } = {}) {
    if (pendingHandle !== null) {
      cancelFrame(pendingHandle);
      pendingHandle = null;
    }
    if (clear) {
      pendingJobs.clear();
    }
  }

  function dispose() {
    cancel({ clear: true });
    disposed = true;
    lastErrors = [];
  }

  return {
    enqueue,
    flush,
    cancel,
    dispose,
    clear: () => pendingJobs.clear(),
    getPendingKeys: () => Array.from(pendingJobs.keys()),
    getLastErrors: () => lastErrors.slice(),
    get isScheduled() {
      return pendingHandle !== null;
    },
    get disposed() {
      return disposed;
    }
  };
}
