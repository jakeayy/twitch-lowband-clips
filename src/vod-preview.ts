// Builds the low-quality replacement for a raw media: the VOD segments that
// cover the raw media's time window, joined into one MP4 blob.

import {
  DOWNLOAD_CONCURRENCY, LOG, RAW_LEAD_LIVE_SECONDS, RAW_LEAD_VOD_SECONDS, VOD_BUILD_TIMEOUT_MS,
  VOD_CATCHUP_TIMEOUT_MS,
} from './config';
import { contextFor } from './context';
import { registerShiftedSource } from './media-shim';
import { firstDecodeTime, patchInit, rebaseSegment } from './mp4';
import type { ClipContext } from './types';
import { mapLimit, sleep, withTimeout } from './util';
import { fetchBytes, fetchText, findVod, lowestVariant, parseMediaPlaylist } from './vod';

const build = async (ctx: ClipContext, rawDuration: number): Promise<string> => {
  const vod = await findVod(ctx);
  const variant = await lowestVariant(vod.vodID);

  let playlist = parseMediaPlaylist(await fetchText(variant.url), variant.url);
  const initUrl = playlist.init;
  if (!initUrl) throw new Error('VOD is not fMP4 (no EXT-X-MAP)');

  // Raw media window in VOD time.
  let windowStart: number;
  if (ctx.vodID) {
    windowStart = ctx.offsetSeconds - RAW_LEAD_VOD_SECONDS;
  } else {
    if (playlist.firstProgramDateTime == null || vod.streamCreatedAt == null || !isFinite(vod.streamCreatedAt)) {
      throw new Error('cannot map broadcast time to VOD time');
    }
    const vodStartsAfterBroadcast = (playlist.firstProgramDateTime - vod.streamCreatedAt) / 1000;
    windowStart = ctx.offsetSeconds - RAW_LEAD_LIVE_SECONDS - vodStartsAfterBroadcast;
  }
  windowStart = Math.max(0, windowStart);
  const windowEnd = windowStart + rawDuration;

  // An in-progress VOD trails the live edge by a few seconds; wait for it.
  const deadline = Date.now() + VOD_CATCHUP_TIMEOUT_MS;
  while (playlist.length < windowEnd && !playlist.ended) {
    if (Date.now() > deadline) throw new Error('VOD did not catch up with the clip window');
    await sleep(2000);
    playlist = parseMediaPlaylist(await fetchText(variant.url), variant.url);
  }

  const segments = playlist.segments.filter((s) => s.start + s.duration > windowStart && s.start < windowEnd);
  if (segments.length === 0) throw new Error('no VOD segments in the clip window');

  const [rawInit, ...media] = await mapLimit([initUrl, ...segments.map((s) => s.url)], DOWNLOAD_CONCURRENCY, fetchBytes);
  const skip = windowStart - segments[0].start;
  const { init, timescales } = patchInit(rawInit, skip + rawDuration);
  const base = firstDecodeTime(media[0], timescales);
  if (!isFinite(base)) throw new Error('could not read segment timestamps');

  const blob = new Blob([init, ...media.map((m) => rebaseSegment(m, base, timescales))], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  registerShiftedSource(url, skip);

  console.info(LOG, `using VOD ${vod.vodID} at ${variant.height}p for the clip editor:`,
    `${segments.length} segments, ${(blob.size / 1e6).toFixed(1)} MB,`,
    `window ${windowStart.toFixed(1)}s-${windowEnd.toFixed(1)}s`);
  return url;
};

const previews = new Map<string, Promise<string | null>>(); // rawMediaID -> blob URL

// Resolves to a blob URL, or null if the preview can't be built.
export const vodPreviewFor = (rawMediaID: string, rawDuration: number): Promise<string | null> => {
  const cached = previews.get(rawMediaID);
  if (cached) return cached;

  const ctx = contextFor(rawMediaID);
  // Not cached: a later response for the same raw media may know more.
  if (!ctx) {
    console.warn(LOG, 'unknown clip context, keeping the lowest Twitch rendition for now');
    return Promise.resolve(null);
  }
  const preview = withTimeout(build(ctx, rawDuration), VOD_BUILD_TIMEOUT_MS, 'VOD download').catch((e: Error) => {
    console.warn(LOG, 'falling back to the lowest Twitch rendition:', e.message);
    return null;
  });
  previews.set(rawMediaID, preview);
  return preview;
};
