export const LOG = '[lowband-clips]';

export const GQL_URL = 'https://gql.twitch.tv/gql';
// Twitch's public web client id, used only if we haven't seen Twitch's own
// GraphQL headers yet.
export const DEFAULT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

// Measured by matching frames of the raw media against the VOD: the raw media
// starts 80s before offsetSeconds in broadcast time for live clips (broadcast
// time counts from stream.createdAt), and 82s before offsetSeconds in VOD time
// for clips made while watching a VOD.
export const RAW_LEAD_LIVE_SECONDS = 80;
export const RAW_LEAD_VOD_SECONDS = 82;

// How long the CREATED response is held back while the VOD preview is built.
export const VOD_BUILD_TIMEOUT_MS = 30000;
// How long to wait for an in-progress VOD to catch up with the clip window.
export const VOD_CATCHUP_TIMEOUT_MS = 25000;
// Renditions at or below this height are small enough to use as they are.
export const MAX_ACCEPTABLE_QUALITY = 360;
// Parallel segment downloads.
export const DOWNLOAD_CONCURRENCY = 4;
