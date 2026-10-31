# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-31

First public release. A from-scratch rewrite of the abandoned
[jellyfinLaunchPotplayer](https://greasyfork.org/en/scripts/452398-jellyfinlaunchpotplayer)
1.0.7 (last updated April 2023), which stopped working once Jellyfin changed both its web
client DOM and its query authentication.

### Added

- Player buttons injected into `.detailRibbon > .mainDetailButtons` — the native Play /
  Download row — instead of a floating widget detached from the page.
- Support for PotPlayer, VLC, IINA, nPlayer, Infuse, MX Player and mpv.
- Automatic OS detection: only players available on the current platform are shown.
- Resume position forwarded to the player (`/seek=` on PotPlayer, `i.position` on Android).
- External subtitle attachment, preferring the Chinese track.
- Series / Season / folder resolution to a playable child item.
- Player icons from `bpking1/embyExternalUrl`, inlined as data URIs (no external requests),
  plus the official mpv logo; `CUSTOM_ICONS` and `ICON_SIZE` allow overriding them.
- Floating-row fallback for builds without the detail ribbon.
- Mock harness and static server for reproducing screenshots without a server.
- Console helper: `__JEP__().build('<itemId>')` returns the URLs without launching anything.

### Changed

- Authentication uses the `ApiKey` query parameter; the legacy `api_key` alias is disabled by
  default in Jellyfin 12.
- Uses public `ApiClient` methods (`getCurrentUser`, `serverAddress`, `accessToken`) instead of
  the removed private fields `_serverInfo` / `_serverAddress`.
- Stream URL uses the canonical `/Videos/{id}/stream` path instead of the legacy `/emby/` prefix.
- URLs are prefetched when the detail page opens, so the click handler can navigate
  synchronously and keep the user gesture required for a custom-protocol hand-off.
- Code comments and documentation written in English for the public release.

### Fixed

- Duplicate buttons when navigating between items: Jellyfin keeps visited detail pages in the
  DOM, and only the ribbon with a non-zero layout box is now used.
