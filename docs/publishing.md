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
3. Choose **Import from URL** and paste the **tag-pinned** raw URL:

   ```
   https://raw.githubusercontent.com/dncore/jellyfin-external-player/v1.0.0/jellyfin-external-player.user.js
   ```

   (Greasy Fork reads `@name`, `@description`, `@version`, `@include` from the header.)

   > Use the tag rather than `main`: `raw.githubusercontent.com` caches branch files for a few
   > minutes, so right after a release `main` can still serve the previous version. Tag URLs are
   > immutable and always correct.

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

## 4. Where each piece of the listing lives

Greasy Fork reads only a fixed set of header keys; everything else lives on the site.

| Content | Source of truth | How it reaches Greasy Fork |
|---|---|---|
| Name, summary, version, license, matches | `jellyfin-external-player.user.js` header (`@name`, `@description`, `@version`, `@license`, `@include`) | imported automatically on every publish / update |
| "Additional info" (the long text on the script page) | `docs/greasyfork-listing.md` | **pasted by hand** — it is a site-side field, never read from the file |
| Screenshots | `docs/*.png` in this repo | referenced by absolute `https` URLs in the additional info |
| Source / issue link | `@supportURL` + a line in the additional info | header key is imported; the line is pasted |
| Category, tags | Greasy Fork edit page | set manually |

`docs/greasyfork-listing.md` holds the exact text to paste, so the listing is versioned next to
the code and can be diffed. After editing it, copy the block into **Edit script → Additional
info** on the script page.

Updating the script (re-importing the file) refreshes the code and the header keys, but **does
not** overwrite the additional info — update it by hand when the text changes.

## 5. Update the README

After the first publish, add the Greasy Fork link near the top of `README.md`:

```markdown
[![Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-install-green)](https://greasyfork.org/en/scripts/<id>)
```
