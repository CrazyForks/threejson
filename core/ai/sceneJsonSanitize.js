// Kept as the AI-internal entry so existing AI modules and direct test imports share the pure
// scene-document implementation. Provider-independent consumers must import from core/util.
export * from "../util/sceneJsonSanitize.js";
