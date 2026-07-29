/**
 * `<SceneViewport />` — the smallest useful React component over useScenePlayer: a sized wrapper
 * element containing the canvas the player runtime renders into, optionally auto-loading a scene.
 *
 * Authored with `createElement` rather than JSX on purpose: like the other @threejson/* kits, this
 * package ships raw ESM with **no build step**, so it must stay valid JavaScript as-authored. This
 * is invisible to consumers — they still write `<SceneViewport />`.
 *
 * Deliberately unstyled beyond filling its parent: chrome (loading masks, transport bars, titles)
 * is the app's job. Read the same state this component uses by calling `useScenePlayer()` yourself,
 * or grab it via `onReady`.
 */
import { createElement, useEffect, useRef } from "react";
import { useScenePlayer } from "./useScenePlayer.js";

const WRAP_STYLE = { position: "relative", width: "100%", height: "100%" };
const CANVAS_STYLE = { display: "block", width: "100%", height: "100%" };

/**
 * @param {object} props
 * @param {string} [props.src] scene URL to load (and re-load whenever it changes). Resolved by
 *   player-kit against the @threejson/assets CDN unless it is already absolute.
 * @param {(player: ReturnType<typeof useScenePlayer>) => void} [props.onReady] called once the
 *   runtime is mounted, with the full player API.
 * @param {string} [props.className]
 * @param {object} [props.style] merged over the default fill-parent wrapper style.
 * @param {object} [props.canvasProps] extra props for the inner <canvas>.
 * @param {...any} props.rest forwarded to createPlayerRuntime (assetsBase, assetGatewayUrl, …).
 */
export function SceneViewport({ src, onReady, className, style, canvasProps, ...playerOptions }) {
  const player = useScenePlayer(playerOptions);
  const { ready, loadFromUrl } = player;

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const playerRef = useRef(player);
  playerRef.current = player;

  useEffect(() => {
    if (ready) {
      onReadyRef.current?.(playerRef.current);
    }
  }, [ready]);

  useEffect(() => {
    if (ready && src) {
      void loadFromUrl(src);
    }
  }, [ready, src, loadFromUrl]);

  return createElement(
    "div",
    {
      ref: player.canvasWrapRef,
      className,
      style: style ? { ...WRAP_STYLE, ...style } : WRAP_STYLE
    },
    createElement("canvas", {
      ...canvasProps,
      ref: player.canvasRef,
      style: canvasProps?.style ? { ...CANVAS_STYLE, ...canvasProps.style } : CANVAS_STYLE
    })
  );
}
