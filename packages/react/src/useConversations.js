/**
 * React binding for @threejson/host-kit's ThreeBox session store (IndexedDB).
 *
 * Unlike usePlaylist, the underlying store is a plain async CRUD module with no subscription — it is
 * the database, not an observable. So this hook owns the cached list and re-reads after each write,
 * which keeps IndexedDB the single source of truth rather than maintaining a parallel in-memory copy
 * that can drift from it.
 *
 * Turns are deliberately *not* loaded with the list: a conversation's turns include full scene
 * snapshots (often hundreds of KB each), so loading every conversation's turns to render a sidebar
 * would pull the entire database into memory. Call `loadTurns(id)` for the active conversation only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createConversationId,
  deleteConversation as deleteConversationRecord,
  getAllConversations,
  getTurnsForConversation,
  putConversation,
  putTurn
} from "@threejson/host-kit/js/threeBoxSessionStore.js";

/** Most recently touched first; pinned conversations always above the rest. */
function sortConversations(list) {
  return [...list].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

/**
 * @param {object} [options]
 * @param {boolean} [options.includeArchived=false]
 */
export function useConversations({ includeArchived = false } = {}) {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // IndexedDB is unavailable in SSR and in some privacy modes; the app should degrade to a
  // session-only history rather than fail to render.
  const available = typeof indexedDB !== "undefined";

  const refresh = useCallback(async () => {
    if (!available) {
      setLoading(false);
      return [];
    }
    try {
      const all = await getAllConversations();
      const visible = includeArchived ? all : all.filter((c) => !c.archived);
      const sorted = sortConversations(visible);
      setConversations(sorted);
      setError(null);
      return sorted;
    } catch (err) {
      setError(String(err?.message || err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [available, includeArchived]);

  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) {
      return;
    }
    mountedRef.current = true;
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async ({ title = "", projectId = null } = {}) => {
      const record = {
        id: createConversationId(),
        title,
        updatedAt: Date.now(),
        pinned: false,
        archived: false,
        projectId
      };
      if (available) {
        await putConversation(record);
        await refresh();
      } else {
        setConversations((prev) => sortConversations([record, ...prev]));
      }
      setActiveId(record.id);
      return record;
    },
    [available, refresh]
  );

  /** Partial update; always bumps `updatedAt` so the list re-orders the way a user expects. */
  const update = useCallback(
    async (id, partial) => {
      const current = conversations.find((c) => c.id === id);
      if (!current) {
        return null;
      }
      const next = { ...current, ...partial, updatedAt: Date.now() };
      if (available) {
        await putConversation(next);
        await refresh();
      } else {
        setConversations((prev) => sortConversations(prev.map((c) => (c.id === id ? next : c))));
      }
      return next;
    },
    [conversations, available, refresh]
  );

  const remove = useCallback(
    async (id) => {
      if (available) {
        await deleteConversationRecord(id);
        await refresh();
      } else {
        setConversations((prev) => prev.filter((c) => c.id !== id));
      }
      // Clearing the pointer is the caller's cue to reset the view; leaving it set would leave the
      // UI showing a conversation that no longer exists.
      setActiveId((prev) => (prev === id ? null : prev));
    },
    [available, refresh]
  );

  const loadTurns = useCallback(
    async (id) => {
      if (!available || !id) {
        return [];
      }
      try {
        return await getTurnsForConversation(id);
      } catch (err) {
        setError(String(err?.message || err));
        return [];
      }
    },
    [available]
  );

  /**
   * Appends a turn and touches the conversation.
   *
   * `seq` is assigned from the stored turn count rather than a render-time counter so that a
   * reopened conversation continues numbering correctly instead of restarting at 0 and colliding.
   */
  const appendTurn = useCallback(
    async (conversationId, turn) => {
      if (!available || !conversationId) {
        return null;
      }
      const existing = await getTurnsForConversation(conversationId);
      const record = {
        createdAt: Date.now(),
        ...turn,
        id: turn.id || `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        conversationId,
        seq: existing.length
      };
      await putTurn(record);
      await update(conversationId, {});
      return record;
    },
    [available, update]
  );

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  return {
    conversations,
    active,
    activeId,
    setActiveId,
    loading,
    error,
    /** False when IndexedDB is unavailable — history is session-only. */
    persistent: available,
    refresh,
    create,
    update,
    remove,
    loadTurns,
    appendTurn
  };
}
