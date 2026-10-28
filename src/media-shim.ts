// The VOD preview starts at a segment boundary, `skip` seconds before the raw
// media's first frame. Media elements playing one of those previews see a
// timeline shifted by `skip`, so their time 0 is the raw media's time 0.

const shifts = new Map<string, number>(); // blob URL -> skip seconds

export const registerShiftedSource = (url: string, skip: number): void => {
  shifts.set(url, skip);
};

const shiftOf = (el: HTMLMediaElement): number => {
  if (shifts.size === 0) return 0;
  // Ignore a fragment such as the portrait marker.
  const src = (el.currentSrc || el.getAttribute('src') || '').split('#')[0];
  return shifts.get(src) ?? 0;
};

const shiftedRanges = (ranges: TimeRanges, skip: number): TimeRanges => {
  const list: Array<[number, number]> = [];
  for (let i = 0; i < ranges.length; i++) {
    const start = Math.max(0, ranges.start(i) - skip);
    const end = ranges.end(i) - skip;
    if (end > start) list.push([start, end]);
  }
  const at = (i: number) => {
    if (i >= list.length) throw new DOMException('Index out of range', 'IndexSizeError');
    return list[i];
  };
  return {
    get length() { return list.length; },
    start: (i: number) => at(i)[0],
    end: (i: number) => at(i)[1],
  };
};

type Getter<T> = (this: HTMLMediaElement) => T;

const wrapGetter = <T>(name: string, wrap: (value: T, skip: number) => T): void => {
  const proto = HTMLMediaElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, name);
  const get = desc?.get as Getter<T> | undefined;
  if (!desc || !get) return;
  Object.defineProperty(proto, name, {
    ...desc,
    get(this: HTMLMediaElement) {
      const skip = shiftOf(this);
      const value = get.call(this);
      return skip ? wrap(value, skip) : value;
    },
  });
};

export const installMediaShim = (): void => {
  const proto = HTMLMediaElement.prototype;
  const currentTime = Object.getOwnPropertyDescriptor(proto, 'currentTime');
  if (!currentTime?.get || !currentTime.set) return;
  const getTime = currentTime.get as Getter<number>;
  const setTime = currentTime.set as (this: HTMLMediaElement, v: number) => void;

  Object.defineProperty(proto, 'currentTime', {
    ...currentTime,
    get(this: HTMLMediaElement) {
      const skip = shiftOf(this);
      const v = getTime.call(this);
      return skip ? Math.max(0, v - skip) : v;
    },
    set(this: HTMLMediaElement, v: number) {
      const skip = shiftOf(this);
      setTime.call(this, skip ? Number(v) + skip : v);
    },
  });
  wrapGetter<number>('duration', (v, skip) => (isFinite(v) ? Math.max(0, v - skip) : v));
  for (const name of ['buffered', 'seekable', 'played']) wrapGetter<TimeRanges>(name, shiftedRanges);

  const fastSeek = proto.fastSeek as ((this: HTMLMediaElement, t: number) => void) | undefined;
  if (typeof fastSeek === 'function') {
    proto.fastSeek = function (this: HTMLMediaElement, t: number) {
      const skip = shiftOf(this);
      fastSeek.call(this, skip ? Number(t) + skip : t);
    };
  }

  // Start shifted elements at the raw media's first frame, not the segment start.
  document.addEventListener('loadedmetadata', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLMediaElement)) return;
    const skip = shiftOf(el);
    if (skip && getTime.call(el) < skip) setTime.call(el, skip);
  }, true);
};
