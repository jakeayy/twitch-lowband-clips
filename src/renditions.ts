import { LOG } from './config';
import type { RawMediaAsset, Rendition } from './types';

export const qualityNum = (r: Rendition): number => {
  const n = parseInt(r.quality ?? '', 10);
  return isNaN(n) ? r.height ?? 0 : n;
};

// Same check as Twitch's own rendition picker.
const codecSupported = (codecs: string | undefined): boolean => {
  if (!codecs) return true;
  try {
    const type = `video/mp4;codecs="${codecs}"`;
    if ('MediaSource' in window) return MediaSource.isTypeSupported(type);
    const res = document.createElement('video').canPlayType(type);
    return res === 'probably' || res === 'maybe';
  } catch {
    return true;
  }
};

const pickLowest = (renditions: Rendition[]): Rendition | null => {
  const playable = renditions.filter((r) => r && r.sourceURL && codecSupported(r.codecs));
  if (playable.length === 0) return null;
  return playable.reduce((best, r) => {
    const dq = qualityNum(r) - qualityNum(best);
    if (dq !== 0) return dq < 0 ? r : best;
    return (r.bitrate ?? 0) < (best.bitrate ?? 0) ? r : best;
  });
};

// Twitch plays the highest playable rendition; leave it only the lowest one.
export const keepLowestRendition = (asset: RawMediaAsset): boolean => {
  const renditions = asset.renditions;
  if (!Array.isArray(renditions) || renditions.length < 2) return false;
  const lowest = pickLowest(renditions);
  if (!lowest) return false;
  console.debug(LOG, `asset ${asset.id}: keeping ${lowest.quality}p out of`,
    renditions.map((r) => `${r.quality}/${r.videoCodec ?? r.codecs}`).join(', '));
  asset.renditions = [lowest];
  return true;
};

export const isLandscape = (asset: RawMediaAsset): boolean => (asset.aspectRatio ?? 0) >= 1;
