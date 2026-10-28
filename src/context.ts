// Which broadcast or VOD, and which offset, a raw media was created from.

import type { ClipContext } from './types';

const contexts = new Map<string, ClipContext>();

// clips.twitch.tv/create is opened as /create?offsetSeconds=…&broadcastID=…
// &broadcasterLogin=…&vodID=…; the router moves these into history.state and
// rewrites the URL, so keep a copy from page start.
const initialParams = new URLSearchParams(location.search);

interface HistoryInfo {
  rawMediaID?: string;
  vodID?: string | null;
  broadcastID?: string | null;
  offsetSeconds?: number | string;
  broadcasterLogin?: string;
}

const historyInfo = (): HistoryInfo => {
  try {
    const state = history.state as { usr?: unknown } | null;
    const info = state?.usr ?? state;
    return info && typeof info === 'object' ? info as HistoryInfo : {};
  } catch {
    return {};
  }
};

const RESERVED_PATHS = ['videos', 'directory', 'settings', 'subscriptions', 'inventory', 'wallet',
  'drops', 'search', 'downloads', 'jobs', 'p', 'u'];

const loginFromLocation = (): string | null => {
  if (location.hostname !== 'www.twitch.tv') return null;
  const parts = location.pathname.split('/').filter(Boolean).map((p) => p.toLowerCase());
  // twitch.tv/popout/<login>/..., twitch.tv/moderator/<login>, twitch.tv/embed/<login>/...
  const login = ['popout', 'moderator', 'embed'].includes(parts[0]) ? parts[1] : parts[0];
  if (!login || RESERVED_PATHS.includes(login)) return null;
  return login;
};

export const pageLogin = (): string | null =>
  historyInfo().broadcasterLogin || initialParams.get('broadcasterLogin') || loginFromLocation();

// Records the input of a CreateRawMedia request once its response names the
// raw media it created.
export const rememberCreateRequest = (body: string, json: unknown): void => {
  try {
    const reqs = JSON.parse(body) as unknown;
    const requests = (Array.isArray(reqs) ? reqs : [reqs]) as Array<{
      operationName?: string;
      variables?: { input?: { vodID?: string | null; broadcastID?: string | null; offsetSeconds?: number } };
    }>;
    const responses = (Array.isArray(json) ? json : [json]) as Array<{
      data?: { createRawMedia?: { rawMedia?: { id?: string } } };
    }>;
    requests.forEach((req, i) => {
      if (req?.operationName !== 'CreateRawMedia') return;
      const input = req.variables?.input;
      const id = responses[i]?.data?.createRawMedia?.rawMedia?.id;
      if (!input || !id) return;
      contexts.set(id, {
        rawMediaID: id,
        vodID: input.vodID || null,
        broadcastID: input.broadcastID || null,
        offsetSeconds: Number(input.offsetSeconds),
        login: pageLogin(),
      });
    });
  } catch {
    // Not a request we understand.
  }
};

export const contextFor = (rawMediaID: string): ClipContext | null => {
  const known = contexts.get(rawMediaID);
  if (known) return known;
  // clips.twitch.tv/create keeps the context in history.state.
  const st = historyInfo();
  if (st.rawMediaID !== rawMediaID || st.offsetSeconds == null) return null;
  return {
    rawMediaID,
    vodID: st.vodID || null,
    broadcastID: st.broadcastID || null,
    offsetSeconds: Number(st.offsetSeconds),
    login: st.broadcasterLogin || null,
  };
};
