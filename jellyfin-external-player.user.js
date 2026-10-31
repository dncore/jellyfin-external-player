// ==UserScript==
// @name         Jellyfin External Player
// @namespace    https://github.com/dncore/jellyfin-external-player
// @version      1.0.0
// @description  Adds external player buttons (PotPlayer, VLC, IINA, nPlayer, Infuse, MX Player, mpv) to the Jellyfin item detail page. Plays the original file directly, no transcoding.
// @description:zh-CN  在 Jellyfin 详情页加入外部播放器按钮（PotPlayer / VLC / IINA / nPlayer / Infuse / MX Player / mpv），直连原文件播放，不转码。
// @author       dncore
// @license      MIT
// @homepageURL  https://github.com/dncore/jellyfin-external-player
// @supportURL   https://github.com/dncore/jellyfin-external-player/issues
// @include      *://*/web/index.html*
// @include      *://*:8096/*
// @run-at       document-end
// @noframes
// @grant        none
// ==/UserScript==

/*
 * How it works
 * ------------
 * 1. The buttons are injected into `.detailRibbon > .mainDetailButtons`, the same
 *    row that holds Play / Download / Favorite on an item page. Jellyfin 12.x still
 *    renders that container, so no fragile React internals are involved.
 *    If it is missing (very old or heavily customised builds) the script falls back
 *    to a floating row in the bottom-right corner.
 * 2. Metadata comes from the web client's global `ApiClient` (public methods only).
 * 3. The stream URL is built as `/Videos/{id}/stream.{container}?static=true`.
 *    `static=true` asks the server for the original file instead of a transcode.
 * 4. Auth uses the `ApiKey` query parameter. Jellyfin 12 disabled the legacy
 *    `api_key` alias by default, which is why older scripts stopped working.
 * 5. URLs are prefetched when the detail page opens. Browsers only allow a custom
 *    protocol hand-off for a short window after a real user gesture, so the click
 *    handler must navigate synchronously instead of awaiting network calls first.
 *
 * Jellyfin keeps previously visited detail pages alive in the DOM. Only the ribbon
 * that currently has a layout box is the visible one; injecting into a cached page
 * would stack duplicate buttons, hence `activeBar()`.
 */

(function () {
    'use strict';

    // ==================== Configuration ====================
    const CFG = {
        SEEK_RESUME: true,        // resume from the last playback position
        LOAD_SUBTITLE: true,      // attach external subtitles (Chinese preferred)
        SHOW_ALL_PLAYERS: false,  // true = ignore OS filtering, show every player
        PREFERRED: 'potplayer',   // player used by the hotkey
        HOTKEY: 'alt+p',          // set to '' to disable
        ICON_SIZE: 24,            // icon edge in px (matches Jellyfin's Material icons)
        CUSTOM_ICONS: {},         // per-player icon override, e.g. { potplayer: 'https://x/p.png' }
        FALLBACK_FLOAT: true      // fall back to a floating row when the ribbon is absent
    };
    // =======================================================

    const TAG = '[Jellyfin-External-Player]';
    const log = (...a) => console.log('%c' + TAG, 'color:#e5a00d;font-weight:bold', ...a);
    const warn = (...a) => console.warn(TAG, ...a);
    const mask = s => String(s).replace(/ApiKey=[^&\s]+/gi, 'ApiKey=***');

    /* ---------------- Platform detection ---------------- */

    const OS = (() => {
        const ua = navigator.userAgent;
        // iPadOS reports itself as Macintosh; touch points disambiguate it.
        if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
        if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
        if (/Android/i.test(ua)) return 'android';
        if (/Windows/i.test(ua)) return 'windows';
        if (/Macintosh|MacIntel/i.test(ua)) return 'macos';
        return 'other';
    })();

    /* ---------------- Player definitions ----------------
     * Each player declares the platforms it runs on and how to turn media
     * information into a launch URL.
     * info = { stream, sub, title, seek, positionMs }
     * ----------------------------------------------------- */

    const PLAYERS = [
        {
            id: 'potplayer', label: 'PotPlayer', short: 'POT', color: '#e5a00d',
            os: ['windows'],
            build: i => `potplayer://${i.stream}`
                + (i.sub ? ` /sub=${i.sub}` : '')
                + ' /current'
                + (i.title ? ` /title="${i.title}"` : '')
                + (i.seek ? ` /seek=${i.seek}` : '')
        },
        {
            id: 'vlc', label: 'VLC', short: 'VLC', color: '#ff8800',
            os: ['windows', 'macos', 'ios', 'android'],
            build: i => {
                if (OS === 'ios') {
                    return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(i.stream)}`
                        + (i.sub ? `&sub=${encodeURIComponent(i.sub)}` : '');
                }
                if (OS === 'android') {
                    return `intent:${i.stream}#Intent;package=org.videolan.vlc;type=video/*`
                        + `;S.subtitles_location=${encodeURIComponent(i.sub || '')}`
                        + `;S.title=${encodeURIComponent(i.title || '')}`
                        + `;i.position=${i.positionMs};end`;
                }
                // Desktop VLC does not register `vlc://` by itself; a handler is required.
                return `vlc://${i.stream}`;
            }
        },
        {
            id: 'iina', label: 'IINA', short: 'IINA', color: '#2b7cd3',
            os: ['macos'],
            build: i => `iina://weblink?url=${encodeURIComponent(i.stream)}&new_window=1`
        },
        {
            id: 'nplayer', label: 'nPlayer', short: 'nP', color: '#00a0e9',
            os: ['macos', 'ios'],
            build: i => OS === 'ios'
                ? `nplayer-${encodeURIComponent(i.stream)}`
                : `nplayer-mac://weblink?url=${encodeURIComponent(i.stream)}&new_window=1`
        },
        {
            id: 'infuse', label: 'Infuse', short: 'INF', color: '#ff6f00',
            os: ['macos', 'ios'],
            build: i => `infuse://x-callback-url/play?url=${encodeURIComponent(i.stream)}`
        },
        {
            id: 'mx', label: 'MX Player', short: 'MX', color: '#00b39b',
            os: ['android'],
            build: i => `intent:${i.stream}#Intent;package=com.mxtech.videoplayer.ad`
                + `;S.title=${encodeURIComponent(i.title || '')}`
                + `;i.position=${i.positionMs};end`
        },
        {
            id: 'mpv', label: 'mpv', short: 'mpv', color: '#691f4a',
            os: ['windows', 'macos'],
            build: i => `mpv://${encodeURIComponent(i.stream)}`
        }
    ];

    const visiblePlayers = () => CFG.SHOW_ALL_PLAYERS
        ? PLAYERS
        : PLAYERS.filter(p => p.os.includes(OS));

    /* ---------------- Jellyfin data access ---------------- */

    const ID_RE = /[?&]id=([0-9a-f]{6,})/i;
    const HEX_RE = /^[0-9a-f]{6,}$/i;

    const apiReady = () => !!(window.ApiClient
        && typeof window.ApiClient.getItem === 'function'
        && typeof window.ApiClient.accessToken === 'function'
        && typeof window.ApiClient.serverAddress === 'function');

    const itemIdFromHash = () => {
        const m = ID_RE.exec(location.hash || '');
        return m ? m[1] : null;
    };
    const isDetailsRoute = () => /#\/details/i.test(location.hash || '') && !!itemIdFromHash();
    const serverBase = () => String(window.ApiClient.serverAddress() || '').replace(/\/+$/, '');

    function selectedMediaSourceId() {
        const sel = document.querySelector('select.selectSource');
        if (sel && HEX_RE.test(String(sel.value || ''))) return sel.value;
        return null;
    }

    function seekString(ticks) {
        if (!CFG.SEEK_RESUME || !ticks || ticks <= 0) return '';
        const total = Math.floor(ticks / 10000000); // ticks are 100ns units
        const pad = n => String(n).padStart(2, '0');
        return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    }

    async function firstPlayableChild(userId, parentId, types) {
        const list = await window.ApiClient.getItems(userId, {
            ParentId: parentId, Recursive: true, IncludeItemTypes: types,
            SortBy: 'SortName', SortOrder: 'Ascending', Limit: 1
        });
        const hit = list && list.Items && list.Items[0];
        return hit ? await window.ApiClient.getItem(userId, hit.Id) : null;
    }

    // Series / Season / folders have no playable stream of their own; walk down one level.
    async function resolvePlayable(target, userId) {
        try {
            if (target.Type === 'Series') {
                const next = await window.ApiClient.getNextUpEpisodes({ SeriesId: target.Id, UserId: userId });
                if (next && next.Items && next.Items.length) {
                    return await window.ApiClient.getItem(userId, next.Items[0].Id);
                }
                return (await firstPlayableChild(userId, target.Id, 'Episode')) || target;
            }
            if (target.Type === 'Season') {
                return (await firstPlayableChild(userId, target.Id, 'Episode')) || target;
            }
            if (!target.MediaSources || !target.MediaSources.length) {
                return (await firstPlayableChild(userId, target.Id, 'Movie,Episode,Video')) || target;
            }
        } catch (e) {
            warn('could not resolve a playable child, using the current item', e);
        }
        return target;
    }

    function pickSubtitle(target, source, token) {
        if (!CFG.LOAD_SUBTITLE) return '';
        const external = ((source && source.MediaStreams) || []).filter(s => s.IsExternal);
        if (!external.length) return '';
        const chosen = external.find(s => /chi|zh/i.test(String(s.Language || ''))) || external[0];
        if (!chosen || chosen.Index === undefined) return '';
        return `${serverBase()}/Videos/${target.Id}/${source.Id}/Subtitles/${chosen.Index}/Stream.${chosen.Codec || 'srt'}?ApiKey=${token}`;
    }

    // One API round-trip, then derive the launch URL of every player from it.
    async function buildAll(itemId) {
        const userId = (await window.ApiClient.getCurrentUser()).Id;
        let target = await window.ApiClient.getItem(userId, itemId);
        target = await resolvePlayable(target, userId);

        const sources = target.MediaSources;
        if (!sources || !sources.length) throw new Error('this item has no directly playable media source');

        const msId = selectedMediaSourceId() || sources[0].Id;
        const source = sources.find(s => s.Id === msId) || sources[0];
        const container = source.Container || target.Container || 'mkv';
        const token = window.ApiClient.accessToken();

        const info = {
            stream: `${serverBase()}/Videos/${target.Id}/stream.${container}?static=true&mediaSourceId=${msId}&ApiKey=${token}`,
            sub: pickSubtitle(target, source, token),
            title: String(source.Path || target.Name || '').split('/').pop(),
            seek: seekString(target.UserData && target.UserData.PlaybackPositionTicks),
            positionMs: Math.max(0, Math.floor(((target.UserData && target.UserData.PlaybackPositionTicks) || 0) / 10000))
        };

        const commands = {};
        for (const p of PLAYERS) {
            try { commands[p.id] = p.build(info); } catch (e) { warn(p.id, e); }
        }
        return { commands, title: info.title, info };
    }

    /* ---------------- Prefetch cache ----------------
     * Custom-protocol navigation is only allowed shortly after a user gesture,
     * so the URL must be ready before the click. Build it when the page opens.
     * ------------------------------------------------- */

    let cache = { itemId: null, commands: null, at: 0 };
    let building = null;

    async function prefetch() {
        const id = itemIdFromHash();
        if (!id || !isDetailsRoute() || !apiReady()) return;
        if (cache.itemId === id && Date.now() - cache.at < 5 * 60 * 1000) return;
        if (building) return;
        building = buildAll(id)
            .then(res => {
                cache = { itemId: id, commands: res.commands, at: Date.now() };
                log('prefetched', res.title, Object.keys(res.commands));
            })
            .catch(e => warn('prefetch failed:', e.message))
            .finally(() => { building = null; });
    }

    /* ---------------- Icons ----------------
     * The webp set from bpking1/embyExternalUrl (the one the original script used),
     * downscaled to 64x64 and inlined as data URIs so no CDN request is made.
     * mpv uses its official logo. A letter badge is drawn when an icon is missing.
     * --------------------------------------- */
    const ICONS = {
        potplayer: 'data:image/webp;base64,UklGRtYIAABXRUJQVlA4WAoAAAAwAAAAPwAAPwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZBTFBIjwEAAAmQJNm2aVvz7mc1wLbVANu27VdSD/zet23baoBt+/+qfY291yr9WkRMgAbSU1pLvWD+zdFNN0HbdY9We7nfCxZ9B69rtdud6Ixpv1ZDYsMP7QiNldopSF/ULlPXqu2D0kFtrRrxfROU7/qiUZD/1xkE3f5lSDtwAkTP75D0uBxk6+9JeRcCwpGvJDz0BGnfuzbtCwPxqB02ZFWCfH2qVeIsGF7SWPMFLD9b0ejCw63O0jYw3WlhKdguMzfEZ9DMKBiPmixwWgDgAtYuwDpe64AGXg3gH88toYlbWxm30kBuvvjv+4rbuyPcjm7ntuU6t6vgv4/XXqCTVyfwldc3AJOcJgBgmtOMCdbyWQ+zfXx6zKGLSwcsbvzF4+dmS3Dn4Q4r/xVxyNVag5PH6B04B+tLX1B7XA1bgz/RehcB2z2fU3rkC5khR+jsiYTc8gIqWfWQfdr+J4VvdhchX+varq7eQwelW8Q6NcvEHijvFWPyRsQoSM4J990ytrqK5SD7vUGIxCXPLD2ZjxOi7SfkAgBWUDggUAUAABAeAJ0BKkAAQAA+KRCGQqGhCgYDKgwBQlsAJ05rv5n0ekneMfjN+Mnys0x+P/cz9tf8ZkCPq/+A/K7+Z9oDzAP0S/sH5M9oDzAfyn+mf7v/X9hT0AP5//XOsA9AD9b/Sa/Z34E/2R/63+1+AL+Tfz77+Lx3+LX7Y2fn9t4V5TblH7HeED+1/lvzAfJn5wv5K8wNMI/mX+F/ID/AfRN/af8D7gPZT9O/8z8lfoA/if8v/w39a/df/B///w5+gt+ox3U+ZgSvT4NDjvP4aQ8b+umvRq6iCOCSoICSnPPRNC+1Gw0D/ssF2VZoRc4ZP2zlO+vvXwJU1HUAkAD+//6ULn9F5rbqEhmURCA6OqjUJF+Ce6JhPhgDYdwX7zwz/bM5BfqZ/J506NpBv6PE6IEAyz7HcNCxNCRIaHhl6OLueFKfEojmyS1yX/rD4Qw8H22teveoXKA1cDeWFLIISdp/vW//9c2ilLZL+ErFeSolSXusnib9da9CjY+PZxlqtuX5AtpbUvYkz/p3zdH/338VxW3Re+KWC9jBHu9Td5uO2iXJK0Or9l01z2h0AycSWAgxCMu5hEB5U3cdaM16OP/UHUvlBj466suB6XaOClGHOeoX88G/Yeq4IuhxCGeXYTFJbgQdLHYuGhVvHhgEQndKk+doAJd0mLb2+cXl3Pi0T86IQjsDFNY3iTVNGfYd//Sh/I3Xm8mX4lt0KEJDcHOA14uLVRG/+/j16cnTkB4W6cnMqb9sKjaj5FQg8kOrhaXVz7MNn/slcP382XiL2x6EtHTNljer2mZ6r3ldvZ229fnNscmBUNSMg9J1SXBLgoB3KVcgdb21RC/wML/liwGfWwbz4FDaQ+goM0MePfXw00WY2v0nMex6iunNRUe5lHV9GzNx8LjHW7XHvcmo+iqZkAZLjTeKw2ktIHf7gG1rN6ZXejt3OqCZ9keVexV7e4wW58o6XZTHO92klvhdJMG1ptmCT4OYTjbxiP/RMcMFPH//9L68+qV9AreJKbunoVOnaBmQntzj/MqxMnTSwN+wIXhD+s/dCObZbFggxMaAS+xo4OiGw6ZX/DrkxuTGN6lxRt4kBrA3uj39nr5c2ozMvnWaYC0vkQhCnRiKpCbtoj/5PLf80ZcXweniTg8eg9bdJjuuKiIBSkyunIscgUVotzZFzqOdVjaOxTNZiepBdSsuILTjJ7BerSwuGgpM8xwjJR4Bmz3I7gHQXvey5Xo2oV8zcwQnQK9/qJ3P+0JPnJP8BIskxjZSZVgj+Ns664KEUFccLdag7FiorWBQZwoN4Eusnp8cWsynLOwHCaZt86yJD2D1piHmLnLcFQJLvgM6ioF8CxuO8pXuOM3SVJMBv49JQMlstIsK8GRdDlSQ8bGywOg4CPS/oOm0ygtSC1PT/gMwiJeZDh3Qi6MYj7UWM9Z+q36JxMQ3os2LAL8m8BQE1IntWJz8SRwR1rW8duBEne0eC47lN34vjfynaNu5Jn2wV+UXcLVDt2W7tWur/xJgofxTf+HuW7JSXDFrshUXFHbeVp2fVy9bK1az7H//VEeUgz8muaXpeaUV1lnxuUhpf1O8xl9AfaVHq/BshLDCuN/5Ffa6N53lJO5WNZulLeGB3/lqbiikFBp0OrwehP8gaxkB4iPudp+coHxH7nYAI43hQ8Sj6WPGRrzlouYNwbQ8TXtdR6c8DRw4jqg9i/5u99lRDVJP/yul17y6Hm9BJPcamJGj3xUdy/u6eZAgSWv707hWBO+syJlaiA8ZVfnQkIFHd3HIb/0z7DOMrylb3gU9/++KrUutAg0Q9KIAAAA=',
        vlc: 'data:image/webp;base64,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',
        iina: 'data:image/webp;base64,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',
        nplayer: 'data:image/webp;base64,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',
        infuse: 'data:image/webp;base64,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',
        mx: 'data:image/webp;base64,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',
        mpv: 'data:image/png;base64,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',
    };

    function iconHtml(p) {
        const src = (CFG.CUSTOM_ICONS && CFG.CUSTOM_ICONS[p.id]) || ICONS[p.id];
        const s = CFG.ICON_SIZE || 24;
        if (src) {
            return `<img src="${src}" alt="" aria-hidden="true"`
                + ` style="display:block;width:${s}px;height:${s}px;object-fit:contain;border-radius:4px">`;
        }
        const t = p.short.slice(0, 4);
        const fs = t.length >= 4 ? 7 : t.length === 3 ? 8.5 : 11;
        return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" style="display:block">`
            + `<circle cx="12" cy="12" r="11" fill="${p.color}"/>`
            + `<text x="12" y="${12 + fs / 3}" text-anchor="middle" font-family="system-ui,sans-serif"`
            + ` font-size="${fs}" font-weight="700" fill="#fff">${t}</text></svg>`;
    }

    /* ---------------- Button rendering ---------------- */

    function buildGroup() {
        const wrap = document.createElement('span');
        wrap.className = 'jf-ext-group';
        wrap.style.cssText = 'display:inline-flex;align-items:center;gap:2px;';

        for (const p of visiblePlayers()) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'button-flat detailButton emby-button jf-ext-btn';
            btn.title = `Play with ${p.label}`;
            btn.dataset.player = p.id;
            btn.style.cssText = 'padding:0 6px;';
            btn.innerHTML = `<div class="detailButton-content" style="display:flex;align-items:center;justify-content:center">`
                + `<span class="detailButton-icon" style="display:flex">${iconHtml(p)}</span></div>`;
            btn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                launch(p.id);
            });
            wrap.appendChild(btn);
        }
        return wrap;
    }

    /* Jellyfin keeps visited detail pages in the DOM. Only the ribbon that currently
       has a layout box is visible; the others are 0x0 cached copies. */
    function activeBar() {
        for (const r of document.querySelectorAll('.detailRibbon')) {
            if (!r.getClientRects().length) continue;
            const bar = r.querySelector('.mainDetailButtons');
            if (bar) return bar;
        }
        return null;
    }

    function ensureButtons() {
        if (!isDetailsRoute()) return false;
        const bar = activeBar();
        if (!bar) return false;

        const existing = bar.querySelectorAll('.jf-ext-group');
        if (existing.length > 1) [...existing].slice(1).forEach(g => g.remove());
        if (existing.length >= 1) return true;

        const group = buildGroup();
        // Insert right after Play / Resume, the most natural spot.
        const anchor = bar.querySelector('[data-action="play"]')
            || bar.querySelector('[data-action="resume"]');
        if (anchor && anchor.parentNode === bar && anchor.nextSibling) {
            bar.insertBefore(group, anchor.nextSibling);
        } else if (anchor && anchor.parentNode === bar) {
            bar.appendChild(group);
        } else {
            bar.insertBefore(group, bar.firstChild);
        }
        return true;
    }

    // Fallback for builds without the ribbon: a floating row in the corner.
    let floatGroup = null;
    function ensureFloating() {
        if (!CFG.FALLBACK_FLOAT || !isDetailsRoute()) return;
        const bar = activeBar();
        if (bar && bar.querySelector('.jf-ext-group')) return;
        if (!floatGroup || !floatGroup.isConnected) {
            floatGroup = buildGroup();
            floatGroup.style.cssText += [
                'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483647',
                'padding:6px 10px', 'border-radius:28px',
                'background:rgba(20,20,20,.88)', 'box-shadow:0 6px 20px rgba(0,0,0,.45)'
            ].join(';');
        }
        if (!floatGroup.isConnected) (document.body || document.documentElement).appendChild(floatGroup);
    }

    function removeFloating() {
        if (floatGroup && floatGroup.isConnected) floatGroup.remove();
    }

    /* ---------------- Launch ---------------- */

    async function launch(playerId) {
        const id = itemIdFromHash();
        if (!id) return warn('no item id in the current route');

        const hit = cache.itemId === id && cache.commands && Date.now() - cache.at < 5 * 60 * 1000;
        try {
            let url;
            if (hit && cache.commands[playerId]) {
                url = cache.commands[playerId];
                log('launch (cached)', mask(url));
            } else {
                const res = await buildAll(id);
                cache = { itemId: id, commands: res.commands, at: Date.now() };
                url = res.commands[playerId];
                log('launch', mask(url));
            }
            if (!url) throw new Error('no URL was generated for this player');
            window.location.href = url;
        } catch (e) {
            warn('launch failed:', e.message);
        }
    }

    if (CFG.HOTKEY) {
        document.addEventListener('keydown', e => {
            const key = (e.key || '').toLowerCase();
            const hit = CFG.HOTKEY.split('+').every(part => {
                if (part === 'alt') return e.altKey;
                if (part === 'ctrl') return e.ctrlKey;
                if (part === 'shift') return e.shiftKey;
                return key === part;
            });
            if (!hit || !isDetailsRoute()) return;
            const list = visiblePlayers();
            const target = list.find(p => p.id === CFG.PREFERRED) || list[0];
            if (target) { e.preventDefault(); launch(target.id); }
        }, true);
    }

    /* ---------------- Routing and re-render handling ---------------- */

    let lastHash = location.hash;
    function onRouteMaybeChanged() {
        if (location.hash === lastHash) return;
        lastHash = location.hash;
        cache = { itemId: null, commands: null, at: 0 };
        removeFloating();
        setTimeout(() => {
            ensureButtons();
            prefetch();
            setTimeout(ensureFloating, 1200);
        }, 400);
    }

    const observer = new MutationObserver(() => {
        onRouteMaybeChanged();
        clearTimeout(observer._t);
        observer._t = setTimeout(() => {
            if (isDetailsRoute() && ensureButtons()) removeFloating();
        }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
        onRouteMaybeChanged();
        if (isDetailsRoute() && ensureButtons()) {
            removeFloating();
            prefetch();
        }
    }, 1000);

    const boot = setInterval(() => {
        if (!apiReady()) return;
        clearInterval(boot);
        log('ready', { os: OS, players: visiblePlayers().map(p => p.id) });
        ensureButtons();
        prefetch();
        setTimeout(ensureFloating, 1500);
    }, 500);

    // Console helper: __JEP__().build('<itemId>') returns the URLs without playing.
    window.__JEP__ = () => ({
        os: OS,
        players: visiblePlayers().map(p => p.id),
        build: buildAll,
        state: () => ({ ...cache })
    });

    log('loaded');
})();
