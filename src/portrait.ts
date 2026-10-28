// The portrait asset (the streamer's vertical feed) has no low-quality copy
// anywhere, so its preview is removed instead of downloaded. The asset stays
// in the GraphQL response, so the editor still treats the clip as dual-format
// and saving works exactly as before.
//
// Primary way: patch React's JSX runtime. Nothing here depends on webpack
// module ids or minified names, which change with every Twitch build:
//   - the JSX runtime is found by its source signature (`.jsxs=` and
//     `react.fragment`) and its jsx/jsxs exports are wrapped;
//   - the portrait preview component is recognised by two identifiers that
//     survive minification: the player id "vertical-clip" and the context
//     field `portraitSourceURL` (the other "vertical-clip" component, the
//     edited-clip preview, doesn't read portraitSourceURL).
// The component is swapped for an empty one, and the element that holds it
// (its column, including the "Portrait Version" heading) is dropped.
//
// Fallback: the portrait player is pointed at the landscape preview with a
// marker fragment, and the DOM column around it is hidden.

import { LOG } from './config';

export const PORTRAIT_MARKER = '#lowband-portrait';

let hideDualFormatPortrait = false;

export const setHideDualFormatPortrait = (hide: boolean): void => {
  hideDualFormatPortrait = hide;
  if (hide) {
    patchReact();
    watchPortraitPreviews();
  }
};

// ---------------------------------------------------------------------------
// React patch

type Jsx = ((type: unknown, props: Record<string, unknown> | null, key?: unknown) => unknown) & {
  lowbandOriginal?: Jsx;
};

interface JsxRuntime {
  jsx?: Jsx;
  jsxs?: Jsx;
}

interface WebpackRequire {
  (id: string): unknown;
  m: Record<string, (...args: unknown[]) => unknown>;
}

let reactPatched = false;
const HiddenPortraitPreview = (): null => null;
const portraitComponents = new WeakMap<object, boolean>();

const isPortraitPreviewComponent = (type: unknown): boolean => {
  if (typeof type !== 'function') return false;
  let result = portraitComponents.get(type);
  if (result === undefined) {
    let src = '';
    try {
      src = Function.prototype.toString.call(type);
    } catch {
      // Not inspectable; not ours.
    }
    result = src.includes('"vertical-clip"') && src.includes('portraitSourceURL');
    portraitComponents.set(type, result);
  }
  return result;
};

const holdsHiddenPortrait = (children: unknown): boolean => {
  const isHidden = (c: unknown) => !!c && (c as { type?: unknown }).type === HiddenPortraitPreview;
  return Array.isArray(children) ? children.some(isHidden) : isHidden(children);
};

const wrapJsx = (orig: Jsx): Jsx => {
  const wrapped: Jsx = function (this: unknown, type, props, key) {
    if (hideDualFormatPortrait && props) {
      if (isPortraitPreviewComponent(type) && !props.isReeditMode) {
        return orig.call(this, HiddenPortraitPreview, props, key);
      }
      if (props.children && holdsHiddenPortrait(props.children)) return null;
    }
    return orig.apply(this, arguments as unknown as Parameters<Jsx>);
  };
  wrapped.lowbandOriginal = orig;
  return wrapped;
};

export const patchReact = (): void => {
  if (reactPatched) return;
  try {
    const globals = window as unknown as Record<string, unknown>;
    const chunkName = Object.keys(globals).find((k) => k.startsWith('webpackChunk') && Array.isArray(globals[k]));
    if (!chunkName) return;
    let req: WebpackRequire | null = null;
    // A chunk with a runtime callback receives webpack's require function.
    (globals[chunkName] as unknown[]).push([[Symbol('lowband-clips')], {}, (r: WebpackRequire) => { req = r; }]);
    const require = req as WebpackRequire | null;
    if (!require?.m) return;

    let count = 0;
    for (const id of Object.keys(require.m)) {
      const src = Function.prototype.toString.call(require.m[id]);
      if (!src.includes('.jsxs=') || !src.includes('react.fragment')) continue;
      const runtime = require(id) as JsxRuntime | undefined;
      if (typeof runtime?.jsx !== 'function' || typeof runtime.jsxs !== 'function') continue;
      if (!runtime.jsx.lowbandOriginal) runtime.jsx = wrapJsx(runtime.jsx);
      if (!runtime.jsxs.lowbandOriginal) runtime.jsxs = wrapJsx(runtime.jsxs);
      count++;
    }
    if (count) {
      reactPatched = true;
      console.debug(LOG, `patched ${count} React JSX runtime(s)`);
    }
  } catch (e) {
    console.warn(LOG, 'could not patch React, using the DOM fallback', e);
  }
};

// ---------------------------------------------------------------------------
// DOM fallback

let observer: MutationObserver | null = null;

// The preview sits in a column next to the landscape one; hide the topmost
// ancestor of the portrait <video> that doesn't also contain another video.
const hidePortraitPreview = (video: HTMLVideoElement): void => {
  let el: HTMLElement = video;
  while (el.parentElement && el.parentElement.querySelectorAll('video').length < 2) el = el.parentElement;
  if (!el.parentElement || el === document.body || el === document.documentElement) return;
  el.style.setProperty('display', 'none', 'important');
  video.pause();
  video.dataset.lowbandHidden = '1';
};

const hidePortraitPreviews = (): void => {
  for (const video of document.querySelectorAll<HTMLVideoElement>('video:not([data-lowband-hidden])')) {
    if ((video.getAttribute('src') || video.src).endsWith(PORTRAIT_MARKER)) hidePortraitPreview(video);
  }
};

const watchPortraitPreviews = (): void => {
  if (observer) return;
  let scheduled = false;
  observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      hidePortraitPreviews();
    });
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src'],
  });
};
