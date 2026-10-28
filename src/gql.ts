import { DEFAULT_CLIENT_ID, GQL_URL } from './config';

// Captured before main.ts wraps window.fetch, so our own requests skip the hook.
export const nativeFetch = window.fetch;

const FORWARDED_HEADERS = /^(client-id|authorization|client-integrity|x-device-id|client-session-id|client-version)$/i;

let twitchHeaders: Record<string, string> | null = null;

// Remembers the headers of Twitch's own GraphQL requests so ours look the same.
export const captureGqlHeaders = (init: RequestInit | undefined): void => {
  try {
    if (!init?.headers) return;
    const h = init.headers instanceof Headers
      ? Object.fromEntries(init.headers)
      : { ...(init.headers as Record<string, string>) };
    if (Object.keys(h).some((k) => /^client-id$/i.test(k))) twitchHeaders = h;
  } catch {
    // Unusual headers object; keep the previous ones.
  }
};

const cookieToken = (): string | null => {
  const m = document.cookie.match(/(?:^|;\s*)auth-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

const gqlHeaders = (): Record<string, string> => {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(twitchHeaders ?? {})) {
    if (FORWARDED_HEADERS.test(k)) h[k] = v;
  }
  if (!Object.keys(h).some((k) => /^client-id$/i.test(k))) h['Client-Id'] = DEFAULT_CLIENT_ID;
  if (!Object.keys(h).some((k) => /^authorization$/i.test(k))) {
    const token = cookieToken();
    if (token) h.Authorization = `OAuth ${token}`;
  }
  h['Content-Type'] = 'text/plain;charset=UTF-8';
  return h;
};

export const gql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const res = await nativeFetch(GQL_URL, {
    method: 'POST',
    headers: gqlHeaders(),
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as { data?: T; errors?: unknown };
  if (!json.data) throw new Error('gql: ' + JSON.stringify(json.errors).slice(0, 200));
  return json.data;
};
