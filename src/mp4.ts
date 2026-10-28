// Minimal ISO-BMFF (MP4) box editing for the VOD's fMP4 segments.

interface Box {
  p: number;
  size: number;
  type: string;
}

export type Bytes = Uint8Array<ArrayBuffer>;
export type Timescales = Record<number, number>;

const u32 = (b: Bytes, p: number): number => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];

const w32 = (b: Bytes, p: number, v: number): void => {
  b[p] = (v >>> 24) & 255;
  b[p + 1] = (v >>> 16) & 255;
  b[p + 2] = (v >>> 8) & 255;
  b[p + 3] = v & 255;
};

const children = (b: Bytes, start: number, end: number): Box[] => {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    const size = u32(b, p);
    if (size < 8 || p + size > end) break;
    out.push({ p, size, type: String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]) });
    p += size;
  }
  return out;
};

const childrenOf = (b: Bytes, box: Box): Box[] => children(b, box.p + 8, box.p + box.size);

const find = (boxes: Box[], type: string): Box => {
  const box = boxes.find((x) => x.type === type);
  if (!box) throw new Error(`missing ${type} box`);
  return box;
};

const bytesOf = (b: Bytes, box: Box): Bytes => b.slice(box.p, box.p + box.size);

const makeBox = (type: string, payload: Bytes): Bytes => {
  const b = new Uint8Array(8 + payload.length);
  w32(b, 0, b.length);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  b.set(payload, 8);
  return b;
};

const concat = (arrays: Bytes[]): Bytes => {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of arrays) {
    out.set(a, p);
    p += a.length;
  }
  return out;
};

// mvhd/mdhd timescale and tkhd track_ID sit at the same offsets: 12 bytes in
// for version 0, 20 bytes in for version 1 (64-bit times).
const versionedField = (b: Bytes, box: Box): number => u32(b, box.p + (b[box.p + 8] === 1 ? 28 : 20));

// Adds an edit list to every track so the presentation ends after
// `durationSec`, and returns the track timescales. Firefox honours the edit's
// duration but not a non-zero media_time, so the start offset is handled by
// the media element shim instead.
export const patchInit = (init: Bytes, durationSec: number): { init: Bytes; timescales: Timescales } => {
  const top = children(init, 0, init.length);
  const moov = find(top, 'moov');
  const moovKids = childrenOf(init, moov);
  const movieTimescale = versionedField(init, find(moovKids, 'mvhd'));
  const timescales: Timescales = {};

  const newMoovKids = moovKids.map((k) => {
    if (k.type !== 'trak') return bytesOf(init, k);
    const trakKids = childrenOf(init, k);
    const trackId = versionedField(init, find(trakKids, 'tkhd'));
    timescales[trackId] = versionedField(init, find(childrenOf(init, find(trakKids, 'mdia')), 'mdhd'));

    const elst = new Uint8Array(20); // version 0, flags 0, one entry
    w32(elst, 4, 1);
    w32(elst, 8, Math.round(durationSec * movieTimescale)); // segment_duration
    w32(elst, 12, 0); // media_time
    elst[17] = 1; // media_rate 1.0
    const edts = makeBox('edts', makeBox('elst', elst));

    const parts: Bytes[] = [];
    for (const c of trakKids) {
      if (c.type === 'edts') continue;
      parts.push(bytesOf(init, c));
      if (c.type === 'tkhd') parts.push(edts);
    }
    return makeBox('trak', concat(parts));
  });

  const rest = (keep: (box: Box) => boolean) => top.filter((x) => x !== moov && keep(x)).map((x) => bytesOf(init, x));
  return {
    init: concat([...rest((x) => x.p < moov.p), makeBox('moov', concat(newMoovKids)), ...rest((x) => x.p > moov.p)]),
    timescales,
  };
};

// Calls `fn` with each track fragment's tfdt box and that track's timescale.
const forEachTfdt = (seg: Bytes, timescales: Timescales, fn: (tfdt: Box, timescale: number) => void): void => {
  for (const moof of children(seg, 0, seg.length).filter((x) => x.type === 'moof')) {
    for (const traf of childrenOf(seg, moof).filter((x) => x.type === 'traf')) {
      const kids = childrenOf(seg, traf);
      const tfhd = kids.find((x) => x.type === 'tfhd');
      const tfdt = kids.find((x) => x.type === 'tfdt');
      const timescale = tfhd && timescales[u32(seg, tfhd.p + 12)];
      if (tfdt && timescale) fn(tfdt, timescale);
    }
  }
};

// Earliest decode time in a segment, in seconds.
export const firstDecodeTime = (seg: Bytes, timescales: Timescales): number => {
  const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  let min = Infinity;
  forEachTfdt(seg, timescales, (tfdt, timescale) => {
    const v = seg[tfdt.p + 8] === 1 ? Number(dv.getBigUint64(tfdt.p + 12)) : u32(seg, tfdt.p + 12);
    min = Math.min(min, v / timescale);
  });
  return min;
};

// Shifts every decode time in a segment back by `baseSec`, so the joined
// segments start at zero.
export const rebaseSegment = (segment: Bytes, baseSec: number, timescales: Timescales): Bytes => {
  const seg = segment.slice();
  const dv = new DataView(seg.buffer);
  forEachTfdt(seg, timescales, (tfdt, timescale) => {
    const offset = Math.round(baseSec * timescale);
    if (seg[tfdt.p + 8] === 1) {
      const v = dv.getBigUint64(tfdt.p + 12) - BigInt(offset);
      dv.setBigUint64(tfdt.p + 12, v < 0n ? 0n : v);
    } else {
      w32(seg, tfdt.p + 12, Math.max(0, u32(seg, tfdt.p + 12) - offset));
    }
  });
  return seg;
};
