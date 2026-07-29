/**
 * ThreeBox's IndexedDB database — conversations, turns, uploaded resources, and projects.
 *
 * Headless and framework-agnostic, like the other stores here (`editorSessionIdb`,
 * `playerSettingsStore`, `scenePresetsStore`): it is pure persistence with no UI coupling, so a
 * React shell and a vanilla one can share it unchanged. That is the whole reason it lives in a
 * package rather than in an app — an AI workbench's chat history is the same data whichever
 * framework draws it.
 *
 * Entirely separate from the Scene Editor's database ("threejson_scene_editor"). Four object stores:
 *
 * - **turns** (key `id`, index on `conversationId`) — one AI exchange:
 *   `{ id, conversationId, seq, userPrompt, mode: 'generate'|'adjust'|'template', targetTurnId,
 *      stage, status, errorMessage, sceneJson, commands, spatialSummary, recapSummary,
 *      sceneTitle, createdAt }`.
 *   `sceneJson` is a full scene snapshot as a string, or `null` when the turn was cached as a
 *   commands-only delta — in that case `commands` replays from the nearest earlier turn that still
 *   holds a full snapshot.
 * - **resources** (key `id`, index on `kind`) — files attached from the composer:
 *   `{ id, kind: 'json'|'tjz'|'image'|'model'|'other', name, sceneJson, blob, createdAt }`.
 * - **conversations** (key `id`) — sidebar history metadata:
 *   `{ id, title, updatedAt, pinned, archived, projectId }`. Persisting this is what keeps the
 *   history list alive across a refresh; the turns were always cached, but the list that indexes
 *   them used to live only in memory.
 * - **projects** (key `id`) — `{ id, name }`.
 */
const DB_NAME = "threejson_threebox";
const DB_VERSION = 3;
const STORE_TURNS = "turns";
const STORE_RESOURCES = "resources";
const STORE_CONVERSATIONS = "conversations";
const STORE_PROJECTS = "projects";

let dbPromise = null;

function openDb() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_TURNS)) {
        const store = db.createObjectStore(STORE_TURNS, { keyPath: "id" });
        store.createIndex("conversationId", "conversationId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_RESOURCES)) {
        const store = db.createObjectStore(STORE_RESOURCES, { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
        db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** Runs `fn` in a transaction and resolves once the transaction *commits*, not when fn returns. */
async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Reads a single record by key. */
async function getOne(storeName, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* ── turns ─────────────────────────────────────────────────────────────────── */

export async function putTurn(turn) {
  await withStore(STORE_TURNS, "readwrite", (store) => store.put(turn));
  return turn;
}

export async function getTurn(id) {
  return getOne(STORE_TURNS, id);
}

/** Turns for one conversation, in `seq` order. */
export async function getTurnsForConversation(conversationId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE_TURNS, "readonly")
      .objectStore(STORE_TURNS)
      .index("conversationId")
      .getAll(conversationId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.seq - b.seq));
    req.onerror = () => reject(req.error);
  });
}

export async function getAllTurns() {
  return getAll(STORE_TURNS);
}

export async function deleteTurnsForConversation(conversationId) {
  const turns = await getTurnsForConversation(conversationId);
  await withStore(STORE_TURNS, "readwrite", (store) => {
    for (const turn of turns) {
      store.delete(turn.id);
    }
  });
}

export function createTurnId() {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── resources ─────────────────────────────────────────────────────────────── */

export async function putResource(resource) {
  await withStore(STORE_RESOURCES, "readwrite", (store) => store.put(resource));
  return resource;
}

export async function getResource(id) {
  return getOne(STORE_RESOURCES, id);
}

/** Newest first — the order the resource library lists them in. */
export async function getAllResources() {
  const list = await getAll(STORE_RESOURCES);
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteResource(id) {
  await withStore(STORE_RESOURCES, "readwrite", (store) => store.delete(id));
}

export function createResourceId() {
  return `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── conversations ─────────────────────────────────────────────────────────── */

export async function putConversation(conversation) {
  await withStore(STORE_CONVERSATIONS, "readwrite", (store) => store.put(conversation));
  return conversation;
}

export async function getConversation(id) {
  return getOne(STORE_CONVERSATIONS, id);
}

export async function getAllConversations() {
  return getAll(STORE_CONVERSATIONS);
}

/**
 * Deletes a conversation *and* its turns.
 *
 * The two deletions are folded together deliberately: turns are keyed by conversation but stored
 * separately, so dropping only the metadata leaves rows nothing can ever reach again. Callers that
 * also call `deleteTurnsForConversation` first are fine — the second pass is a no-op.
 */
export async function deleteConversation(id) {
  await deleteTurnsForConversation(id);
  await withStore(STORE_CONVERSATIONS, "readwrite", (store) => store.delete(id));
}

export function createConversationId() {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── projects ──────────────────────────────────────────────────────────────── */

export async function putProject(project) {
  await withStore(STORE_PROJECTS, "readwrite", (store) => store.put(project));
  return project;
}

export async function getAllProjects() {
  return getAll(STORE_PROJECTS);
}

export function createProjectId() {
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Test/teardown hook: drops the cached connection so the next call reopens the database. */
export function resetSessionStoreConnection() {
  dbPromise = null;
}
