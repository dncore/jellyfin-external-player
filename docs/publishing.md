# Publishing

Notes for the maintainer — how to ship a new version to GitHub and Greasy Fork.

## 1. Bump the version

Edit the header of `jellyfin-external-player.user.js`:

```js
// @version      1.0.1
```

Keep it in sync with `CHANGELOG.md`, and tag the commit with the same number.

## 2. Commit, tag, release

```bash
git add -A
git commit -m "release: 1.0.1"
git tag v1.0.1
git push origin main --tags
gh release create v1.0.1 --title "1.0.1" --notes-file <(sed -n '/## \[1.0.1\]/,/## \[/p' CHANGELOG.md)
```

Attach the script itself so the release has a stable download URL:

```bash
gh release upload v1.0.1 jellyfin-external-player.user.js
```

## 3. Publish / update on Greasy Fork

Greasy Fork has no publishing API — the upload is manual through the web UI.

**First release**

1. Sign in at <https://greasyfork.org> with GitHub.
2. Go to <https://greasyfork.org/scripts/new>.
3. Choose **Import from URL** and paste the raw file URL:

   ```
   https://raw.githubusercontent.com/dncore/jellyfin-external-player/main/jellyfin-external-player.user.js
   ```

   (Greasy Fork reads `@name`, `@description`, `@version`, `@include` from the header.)

4. Add **additional info** — the text in the next section.
5. Set the script **category** to *Jellyfin* or *Media*, and **license** to MIT.
6. Publish.

**Subsequent releases**

Once the script exists, either run the same import again (Greasy Fork detects the newer
`@version` and adds a release), or configure **Auto-update** on the script page and point it at
the raw GitHub file:

```
https://raw.githubusercontent.com/dncore/jellyfin-external-player/main/jellyfin-external-player.user.js
```

The script header deliberately ships **without** `@updateURL` / `@downloadURL`: Greasy Fork
writes its own when it publishes, so installs made from Greasy Fork update automatically.
A copy installed from the GitHub raw URL will not self-update — reinstall it or paste the new
version after a release.

## 4. Suggested Greasy Fork listing text

**Summary**

> Adds external player buttons (PotPlayer, VLC, IINA, nPlayer, Infuse, MX Player, mpv) to the
> Jellyfin item detail page. Plays the original file directly, without transcoding.

**Description**

```markdown
Adds one button per available external player to the Jellyfin item detail page, right after the
native Play button. Clicking a button opens the original file in your own player — direct play,
no transcoding.

Works with **PotPlayer, VLC, IINA, nPlayer, Infuse, MX Player and mpv**. Only the players that
exist on your platform are shown (no IINA on Windows, no PotPlayer on macOS).

**Notes**

- Requires Jellyfin 10.8 or newer (uses the `ApiKey` query parameter).
- URLs are built from the item's media sources; the access token is passed only to your local player.
- Continuing playback resumes from the stored position where the player supports it.
- Desktop VLC and mpv need a `vlc://` / `mpv://` protocol handler installed first.
- No external requests: player icons are inlined in the script.

Source and issue tracker: https://github.com/dncore/jellyfin-external-player
```

## 5. Update the README

After the first publish, add the Greasy Fork link near the top of `README.md`:

```markdown
[![Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-install-green)](https://greasyfork.org/en/scripts/<id>)
```
