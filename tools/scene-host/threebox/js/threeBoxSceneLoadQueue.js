let activeCount = 0;

function emitBusyChanged() {
  window.dispatchEvent(
    new CustomEvent("threebox:scene-load-busy", {
      detail: { busy: activeCount > 0, activeCount }
    })
  );
}

/**
 * Tracks in-flight ThreeBox scene loads (no longer serializes them). Used to be a
 * strict one-at-a-time queue because ThreeJSON's deploy scheduler was process-global,
 * so two concurrent createJsonScene calls could cancel each other's scheduled deploy.
 * core/runtime/runtimeContext.js now gives each createJsonScene call its own deploy
 * scheduler store, so concurrent loads no longer interfere (see
 * tests/runtimeContext.deployScheduler.test.mjs). What's left is a plain busy counter:
 * background work like template-gallery thumbnail generation still wants to know when
 * no load is in flight, so it can wait for a quiet moment instead of competing with a
 * foreground load for the main thread/GPU.
 *
 * @template T
 * @param {() => Promise<T>|T} task
 * @returns {Promise<T>}
 */
export async function enqueueThreeBoxSceneLoad(task) {
  activeCount += 1;
  emitBusyChanged();
  try {
    return await task();
  } finally {
    activeCount = Math.max(0, activeCount - 1);
    emitBusyChanged();
  }
}

export function isThreeBoxSceneLoadBusy() {
  return activeCount > 0;
}
