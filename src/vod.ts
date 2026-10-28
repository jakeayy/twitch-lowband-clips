// Finding the VOD of a broadcast and reading its HLS playlists.

import { pageLogin } from './context';
import { gql, nativeFetch } from './gql';
import type { Bytes } from './mp4';
import type { ClipContext } from './types';

export interface VodInfo {
  vodID: string;
  // Only for live broadcasts: when the stream started (ms since epoch).
  streamCreatedAt?: number;
}

export interface Variant {
  url: string;
  height: number;
  bandwidth: number;
}

export interface Segment {
  url: string;
  start: number;
  duration: number;
}

export interface MediaPlaylist {
  init: string | null;
  segments: Segment[];
  length: number;
  ended: boolean;
  firstProgramDateTime: number | null;
}

interface UserVideosResponse {
  user: {
    stream: { id: string; createdAt: string } | null;
    videos: { edges: Array<{ node: { id: string; broadcast: { id: string } | null } | null } | null> } | null;
  } | null;
}

export const findVod = async (ctx: ClipContext): Promise<VodInfo> => {
  if (ctx.vodID) return { vodID: String(ctx.vodID) };
  const login = ctx.login || pageLogin();
  if (!login || !ctx.broadcastID) throw new Error('no channel login or broadcast id');
  const { user } = await gql<UserVideosResponse>(`query($login: String!) {
    user(login: $login) {
      stream { id createdAt }
      videos(first: 5, type: ARCHIVE, sort: TIME) { edges { node { id broadcast { id } } } }
    }
  }`, { login });
  if (!user) throw new Error('user not found');
  const node = (user.videos?.edges ?? [])
    .map((e) => e?.node)
    .find((n) => n?.broadcast && String(n.broadcast.id) === String(ctx.broadcastID));
  if (!node) throw new Error('no VOD for this broadcast');
  if (!user.stream || String(user.stream.id) !== String(ctx.broadcastID)) throw new Error('broadcast is not live');
  return { vodID: node.id, streamCreatedAt: Date.parse(user.stream.createdAt) };
};

export const fetchText = async (url: string): Promise<string> => {
  const res = await nativeFetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

export const fetchBytes = async (url: string): Promise<Bytes> => {
  const res = await nativeFetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
};

const resolveUrl = (uri: string, base: string): string => new URL(uri, base).href;

interface PlaybackTokenResponse {
  videoPlaybackAccessToken: { value: string; signature: string } | null;
}

export const lowestVariant = async (vodID: string): Promise<Variant> => {
  const { videoPlaybackAccessToken: token } = await gql<PlaybackTokenResponse>(`query($id: ID!) {
    videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) {
      value signature
    }
  }`, { id: vodID });
  if (!token) throw new Error('no playback token');
  const masterUrl = `https://usher.ttvnw.net/vod/${vodID}.m3u8?allow_source=true&allow_audio_only=true`
    + `&playlist_include_framerate=true&player_backend=mediaplayer&p=${Math.floor(Math.random() * 1e6)}`
    + `&sig=${encodeURIComponent(token.signature)}&token=${encodeURIComponent(token.value)}`;
  const lines = (await fetchText(masterUrl)).split('\n');
  let best: Variant | null = null;
  for (let i = 0; i < lines.length; i++) {
    const attrs = lines[i];
    // Skips audio_only, which has no RESOLUTION.
    if (!attrs.startsWith('#EXT-X-STREAM-INF:') || !attrs.includes('RESOLUTION=')) continue;
    const uri = (lines[i + 1] ?? '').trim();
    if (!uri || uri.startsWith('#')) continue;
    // Compare by height first: the source ("chunked") variant may advertise a
    // bogus low bandwidth.
    const height = parseInt(attrs.match(/RESOLUTION=\d+x(\d+)/)?.[1] ?? '', 10) || 0;
    const bandwidth = parseInt(attrs.match(/BANDWIDTH=(\d+)/)?.[1] ?? '', 10) || Infinity;
    if (!best || height < best.height || (height === best.height && bandwidth < best.bandwidth)) {
      best = { url: resolveUrl(uri, masterUrl), height, bandwidth };
    }
  }
  if (!best) throw new Error('no video variant in VOD playlist');
  return best;
};

export const parseMediaPlaylist = (text: string, url: string): MediaPlaylist => {
  const out: MediaPlaylist = { init: null, segments: [], length: 0, ended: false, firstProgramDateTime: null };
  let pendingDuration: number | null = null;
  for (const line of text.split('\n').map((l) => l.trim())) {
    if (line.startsWith('#EXT-X-MAP:')) {
      const uri = line.match(/URI="([^"]+)"/)?.[1];
      if (uri) out.init = resolveUrl(uri, url);
    } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      out.firstProgramDateTime ??= Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length));
    } else if (line.startsWith('#EXTINF:')) {
      pendingDuration = parseFloat(line.slice('#EXTINF:'.length));
    } else if (line === '#EXT-X-ENDLIST') {
      out.ended = true;
    } else if (line && !line.startsWith('#') && pendingDuration != null) {
      out.segments.push({ url: resolveUrl(line, url), start: out.length, duration: pendingDuration });
      out.length += pendingDuration;
      pendingDuration = null;
    }
  }
  return out;
};
