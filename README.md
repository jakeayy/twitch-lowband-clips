# Twitch Low-Bandwidth Clip Editor

A userscript that makes Twitch's clip editor load a small, low-quality preview
instead of the 1080p source video. It works in the in-player clip popup and on
the full-page editor at `clips.twitch.tv/create`.

Opening the clip editor normally downloads a ~90 second 1080p video (around
85 MB). With this script it downloads around 3 MB.

## What it does

- **Landscape preview:** downloads the 90 seconds of the stream's VOD that the
  editor shows, in the VOD's lowest quality (usually 160p), and plays that
  instead of Twitch's 1080p file.
- **Portrait preview:** when the stream has a separate vertical video, that
  preview is removed. There's no low-quality copy of it anywhere. The vertical
  version of your saved clip is not affected.
- **Saving is unchanged.** Twitch saves a clip from its own full-quality copy,
  using only the start and end time you pick, so saved clips keep full quality.

If the VOD can't be used, the script falls back to the lowest quality Twitch
itself offers for the editor, which is often still 1080p. That happens when:

- the channel doesn't save VODs;
- the VOD is subscriber-only and you aren't subscribed;
- the VOD is in an older format the script can't join;
- the download takes longer than 30 seconds.

On a live stream the VOD runs a few seconds behind, so the editor may take a
few seconds longer to open while the script waits for it.

## Install

1. Install a userscript manager such as Violentmonkey or Tampermonkey.
2. Open
   [twitch-lowband-clips.user.js](https://github.com/jakeayy/twitch-lowband-clips/releases/latest/download/twitch-lowband-clips.user.js)
   from the latest release; the manager offers to install it.

The script checks the latest release for updates.

## Build

```sh
npm install
npm run build      # writes dist/twitch-lowband-clips.user.js
npm run watch      # rebuilds on change
npm run typecheck
```

The userscript header is generated from `package.json`: `version` and
`description` come from the top level, everything else from the `userscript`
section. The build also writes `dist/twitch-lowband-clips.meta.js`, the
header on its own, which userscript managers fetch to check for updates.

## Releasing

Every push to `main` runs `.github/workflows/release.yml`, which builds the
script and publishes both files to the release for the version in
`package.json`:

- if `v<version>` doesn't exist yet, it creates that tag and a new release;
- if it does, it moves the tag to the new commit and replaces the release's
  files.

Installed copies only update when the version changes, so bump `version` in
`package.json` for changes users should get.

## How it works

- `src/main.ts` wraps `window.fetch` and rewrites the GraphQL responses for
  `CreateRawMedia` / `GetRawMedia`. Those responses tell the editor which
  video to play.
- `src/vod.ts` and `src/vod-preview.ts` find the broadcast's VOD, pick its
  lowest-quality version and download the segments covering the editor's
  90-second window. `src/mp4.ts` joins them into one MP4 blob.
- `src/media-shim.ts` makes video elements playing that blob report times
  relative to the editor's window, since the blob starts at a segment
  boundary.
- `src/portrait.ts` removes the portrait preview by wrapping React's JSX
  runtime, which it finds in Twitch's webpack modules by a code signature
  rather than module IDs. If that stops matching after a Twitch update, it
  hides the preview's DOM column instead.

The editor's 90-second window starts 80 s before the clip point on live
streams and 82 s before it when clipping a VOD. These offsets were measured
by matching frames against the VOD, so a Twitch change could make them drift;
see `src/config.ts`.

Open the browser console to see what the script did: it logs
`[lowband-clips] using VOD … at 160p …` when the low-quality preview is used,
and a warning when it falls back.
