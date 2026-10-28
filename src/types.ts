// Shapes of the GraphQL `RawMedia` object, as far as this script uses them.

export interface Rendition {
  bitrate?: number;
  codecs?: string;
  duration?: number;
  height?: number;
  width?: number;
  videoCodec?: string;
  quality?: string;
  sourceURL?: string;
}

export interface RawMediaAsset {
  id?: string;
  aspectRatio?: number;
  renditions?: Rendition[] | null;
}

export interface RawMedia {
  id?: string;
  status?: string;
  assets?: RawMediaAsset[] | null;
}

// What a raw media was created from (see CreateRawMedia's input).
export interface ClipContext {
  rawMediaID: string;
  vodID: string | null;
  broadcastID: string | null;
  offsetSeconds: number;
  login: string | null;
}
