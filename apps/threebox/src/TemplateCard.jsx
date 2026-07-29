/**
 * A single template-gallery card. Ported from threebox-cloud's TemplateGallery TemplateCard: shows
 * the placeholder logo until a thumbnail is cached, then lazily captures one (via the offscreen
 * pipeline in lib/threeBoxTemplateThumbnails.js) the first time the card scrolls into view, and
 * drops its captured thumbnail when the cache is cleared from Settings.
 */
import { useEffect, useRef, useState } from "react";
import {
  PLACEHOLDER_THUMB_URL,
  TEMPLATE_THUMB_CACHE_CLEARED_EVENT,
  enqueueThumbnail,
  getCachedThumbnail,
  isThumbAutoCacheEnabled
} from "./lib/threeBoxTemplateThumbnails.js";

export function TemplateCard({ item, label, busy, onSelect }) {
  const [thumbUrl, setThumbUrl] = useState(() => getCachedThumbnail(item.json) || PLACEHOLDER_THUMB_URL);
  const captured = thumbUrl !== PLACEHOLDER_THUMB_URL;
  const cardRef = useRef(null);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const onCacheCleared = () => setThumbUrl(PLACEHOLDER_THUMB_URL);
    window.addEventListener(TEMPLATE_THUMB_CACHE_CLEARED_EVENT, onCacheCleared);
    return () => window.removeEventListener(TEMPLATE_THUMB_CACHE_CLEARED_EVENT, onCacheCleared);
  }, []);

  useEffect(() => {
    if (captured || !isThumbAutoCacheEnabled()) {
      return;
    }
    const el = cardRef.current;
    if (!el) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          observer.unobserve(entry.target);
          enqueueThumbnail(
            item.json,
            () => liveRef.current,
            (dataUrl) => setThumbUrl(dataUrl)
          );
        }
      },
      { rootMargin: "150px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.json, captured]);

  return (
    <button
      ref={cardRef}
      type="button"
      className={`templateCard${busy ? " loading" : ""}`}
      disabled={busy}
      data-json-url={item.json}
      onClick={onSelect}
    >
      <img className={`templateCardThumb${captured ? " captured" : ""}`} alt={label} loading="lazy" src={thumbUrl} />
      <span className="templateCardLabel">{label}</span>
    </button>
  );
}
