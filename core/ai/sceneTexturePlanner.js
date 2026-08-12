import { requestChatCompletion } from "./sceneAiService.js";

const TEXTURE_PLAN_SYSTEM_PROMPT = `You plan semantic texture needs for a ThreeJSON scene.
Return strict JSON only: {"tasks":[...]}. Do not return Markdown.

Each task must contain:
- materialPointer: copy one of the provided materialPointer values exactly
- slots: one or more of baseColor, normal, roughness, metalness, ao, emissive, opacity, bump, displacement
- query: concise English search/generation semantics describing the desired surface or recognizable subject
- sourcePreference: auto, manifest, search, pbr-library, or generate
- generationKind: omit unless generation is appropriate; allowed values are image, seamless, spherical, pbr-set, pbr-derive
- tileable: boolean
- projection: uv or equirectangular
- overwrite: boolean; true only when the user explicitly asks to replace an existing texture
- reason: short explanation

Critical rules:
1. Never output, guess, or recommend a URL, domain, file path, provider, asset ID, or image filename. Acquisition is a separate trusted step.
2. Preserve populated slots. Plan only missing identity-defining or physically useful maps unless the request explicitly requires replacement; only then set overwrite to true.
3. Use search for realistic recognizable subjects and pbr-library for wood, brick, stone, ground, metal, fabric and similar surfaces.
4. Use generate only for custom/stylized content. A plain image generator can satisfy baseColor only; request pbr-set or pbr-derive only when a full PBR set is semantically required.
5. Do not texture generic flat-color primitives, blockouts, helpers, or UI-like objects unless the request calls for it.
6. Prefer a compact plan: one task per material, with all relevant slots in that task.`;

/** Create the single-call semantic planner injected into planSceneTextures. */
export function createSceneTexturePlanner(defaultOptions = {}) {
  return async function requestSceneTexturePlan(input = {}) {
    const options = { ...defaultOptions };
    const signal = input.signal || options.signal;
    const response = await requestChatCompletion({
      ...options,
      signal,
      stream: false,
      temperature: options.texturePlanningTemperature ?? 0.1,
      taskKind: "texture_plan",
      messages: [
        { role: "system", content: TEXTURE_PLAN_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            userRequest: String(input.prompt || ""),
            policy: input.policy || {},
            materials: Array.isArray(input.materials) ? input.materials : []
          })
        }
      ]
    });
    return String(response || "").trim();
  };
}

export async function requestSceneTexturePlan(input, options = {}) {
  return createSceneTexturePlanner(options)(input);
}

export { TEXTURE_PLAN_SYSTEM_PROMPT };
