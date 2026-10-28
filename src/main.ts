// Twitch Low-Bandwidth Clip Editor
//
// How the clip editor gets its video:
//   1. CreateRawMedia({vodID | broadcastID, offsetSeconds}) asks Twitch to cut
//      a ~90s "raw media" MP4 around the clip point.
//   2. GetRawMedia(id) is polled until status is CREATED; the response holds
//      rawMedia.assets[].renditions[] and the editor plays the rendition with
//      the highest `quality`.
//
// Usually the only rendition is the 1080p source (~85 MB per raw media). For
// the landscape asset we build a replacement from the VOD's lowest HLS
// rendition (~3 MB at 160p) and put its blob URL into the response; the
// portrait asset's preview is removed. Saving a clip only sends rawMediaID and
// offsets, so the clip itself is still cut from the source.
//
// If building the VOD preview fails (no VOD, sub-only VOD, old TS-based VOD,
// timeout...), only the lowest rendition Twitch offers is kept.

import { LOG } from './config';
import { rememberCreateRequest } from './context';
import { captureGqlHeaders, nativeFetch } from './gql';
import { installMediaShim } from './media-shim';
import { patchReact } from './portrait';
import { findRawMedias, patchRawMedia } from './raw-media';

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const patchResponse = async (response: Response, body: string): Promise<Response> => {
  const text = await response.clone().text();
  if (!text.includes('"rawMedia"')) return response;
  const json = JSON.parse(text) as unknown;
  rememberCreateRequest(body, json);

  let changed = false;
  for (const rawMedia of findRawMedias(json)) changed = (await patchRawMedia(rawMedia)) || changed;
  if (!changed) return response;

  const patched = new Response(JSON.stringify(json), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.defineProperty(patched, 'url', { value: response.url });
  return patched;
};

window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const isGql = requestUrl(input).includes('gql.twitch.tv');
  if (isGql) captureGqlHeaders(init);
  const response = await nativeFetch.apply(this, arguments as unknown as Parameters<typeof fetch>);
  const body = typeof init?.body === 'string' ? init.body : '';
  if (!isGql || !response.ok || !body.includes('RawMedia')) return response;
  try {
    return await patchResponse(response, body);
  } catch (e) {
    console.warn(LOG, 'failed to patch response', e);
    return response;
  }
};

installMediaShim();
document.addEventListener('DOMContentLoaded', patchReact);
window.addEventListener('load', patchReact);
