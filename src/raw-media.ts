import { MAX_ACCEPTABLE_QUALITY } from './config';
import { PORTRAIT_MARKER, setHideDualFormatPortrait } from './portrait';
import { isLandscape, keepLowestRendition, qualityNum } from './renditions';
import type { RawMedia } from './types';
import { vodPreviewFor } from './vod-preview';

// Collects every `rawMedia` object in a (possibly batched) GraphQL response.
export const findRawMedias = (node: unknown, out: RawMedia[] = [], depth = 0): RawMedia[] => {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  if (Array.isArray(node)) {
    for (const item of node) findRawMedias(item, out, depth + 1);
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'rawMedia' && value && typeof value === 'object' && !Array.isArray(value)) out.push(value as RawMedia);
    findRawMedias(value, out, depth + 1);
  }
  return out;
};

// Rewrites a raw media in place. Returns whether anything changed.
export const patchRawMedia = async (rawMedia: RawMedia): Promise<boolean> => {
  const assets = rawMedia.assets;
  if (!Array.isArray(assets)) return false;
  let changed = false;
  for (const asset of assets) changed = keepLowestRendition(asset) || changed;

  if (rawMedia.status !== 'CREATED' || !rawMedia.id) return changed;
  const landscape = assets.find(isLandscape);
  const rendition = landscape?.renditions?.[0];
  if (!rendition?.sourceURL) return changed;

  if (rendition.duration && qualityNum(rendition) > MAX_ACCEPTABLE_QUALITY) {
    const url = await vodPreviewFor(rawMedia.id, rendition.duration);
    if (url) {
      rendition.sourceURL = url;
      changed = true;
    }
  }

  // Point the portrait player at the landscape preview (no extra download);
  // portrait.ts removes or hides it.
  const portraits = assets.filter((a) => a !== landscape && a.renditions?.[0]);
  setHideDualFormatPortrait(portraits.length > 0);
  for (const asset of portraits) {
    asset.renditions = [{ ...asset.renditions![0], sourceURL: rendition.sourceURL + PORTRAIT_MARKER }];
    changed = true;
  }
  return changed;
};
