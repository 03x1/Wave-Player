/* Wave Player — lyrics diagnostic (v2 transport).

   Play a song that definitely has lyrics, then paste this whole file into the
   Spotify devtools console (Ctrl+Shift+I → Console) and press Enter.

   This mirrors what waveplayer.js v2 actually does: fetch first (with
   Spotify's bearer token for Spotify's own hosts), CosmosAsync behind it as a
   fallback. It reports which leg answered and which one failed, instead of
   collapsing everything into "No lyrics available". */

(async () => {
    const line = (...a) => console.log('%c[wave]', 'color:#6cf;font-weight:700', ...a);
    const bad  = (...a) => console.log('%c[wave]', 'color:#f66;font-weight:700', ...a);
    const good = (...a) => console.log('%c[wave]', 'color:#6f6;font-weight:700', ...a);
    const warn = (...a) => console.log('%c[wave]', 'color:#fc6;font-weight:700', ...a);

    /* ---- 1. Which build is actually running ---------------------------- */

    line('Spicetify:', !!window.Spicetify,
         '| CosmosAsync:', !!window.Spicetify?.CosmosAsync,
         '| Platform.Lyrics:', !!window.Spicetify?.Platform?.Lyrics);
    line('__wavePlayerLoaded (guard claimed):', !!window.__wavePlayerLoaded);

    const srcs = [...document.querySelectorAll('script')]
        .map(s => s.src).filter(s => /waveplayer/i.test(s));
    line('Wave Player script tags:', srcs.length ? srcs : '(none — injected inline?)');

    for (const src of srcs) {
        try {
            const t = await (await fetch(src)).text();
            const v = (t.match(/const VERSION = '([^']+)'/) || [])[1];
            const hasNew = t.includes('viaFetch');
            (hasNew ? good : bad)(`build ${src.split('/').pop().split('?')[0]}:`,
                { version: v, hasNewTransport: hasNew, kb: Math.round(t.length / 1024) });
            if (!hasNew) bad('  ^ this build predates the transport rewrite — that alone explains no lyrics.');
        } catch (e) { warn('could not re-read', src, e?.message); }
    }

    /* ---- 2. Track ------------------------------------------------------ */

    const t = Spicetify?.Player?.data?.item;
    if (!t) return bad('No track playing. Start a song and run this again.');

    const title  = t.name || t.metadata?.title || '';
    const artist = t.artists?.[0]?.name || t.metadata?.artist_name || '';
    const album  = t.album?.name || t.metadata?.album_title || '';
    const ms     = Number(t.duration?.milliseconds || t.duration_ms || t.metadata?.duration || 0);
    const id     = t.uri.split(':').pop();
    line('Track:', { title, artist, album, uri: t.uri, durationMs: ms });
    if (!title) bad('No title in Player.data.item — lrclib/netease/musixmatch all bail out early without it.');
    if (!ms)    warn('No duration — lrclib exact-match and netease length-matching get much weaker.');

    /* ---- 3. Settings (a provider switched off looks exactly like a broken one) */

    line('Provider order :', localStorage.getItem('wp7-prov')     || '(default)');
    line('Providers OFF  :', localStorage.getItem('wp7-prov-off') || '(none)');
    line('Musixmatch token set:', !!localStorage.getItem('wp7-mxm'));

    /* ---- 4. The v2 transport, reproduced verbatim ---------------------- */

    function spotifyAuth() {
        const p = Spicetify.Platform;
        const tok = p?.AuthorizationAPI?.getState?.()?.token
                 || p?.Session?.accessToken
                 || p?.AuthorizationAPI?._state?.token;
        return tok ? { Authorization: `Bearer ${tok}`, 'App-Platform': 'WebPlayer' } : null;
    }

    const auth = spotifyAuth();
    (auth ? good : bad)('spotifyAuth():', auth ? 'token resolved' : 'NO TOKEN — Spotify provider falls straight to Cosmos');

    // Same as viaFetch/cos in waveplayer.js, but it records which leg won.
    async function trace(url) {
        const note = {};
        if (url.startsWith('wg://')) {
            note.leg = 'cosmos (wg:// scheme)';
            note.data = await Spicetify.CosmosAsync.get(url);
            return note;
        }
        const spotify = /(^|\.)spotify\.com$/.test(new URL(url).hostname);
        const headers = spotify ? spotifyAuth() : null;
        try {
            if (spotify && !headers) throw new Error('no access token');
            const res = await fetch(url, headers ? { headers } : undefined);
            if (!res.ok) { const e = new Error('HTTP ' + res.status); e.answered = true; throw e; }
            note.leg = 'fetch';
            note.data = await res.json();
            return note;
        } catch (e) {
            if (e?.answered) { e.leg = 'fetch (server answered ' + e.message + ')'; throw e; }
            note.fetchFailed = e?.message || String(e);
            try {
                note.leg = 'cosmos (fetch failed: ' + note.fetchFailed + ')';
                note.data = await Spicetify.CosmosAsync.get(url);
                return note;
            } catch (e2) {
                const err = new Error(`both legs failed — fetch: ${note.fetchFailed} | cosmos: ${e2?.message || e2}`);
                err.leg = 'none';
                throw err;
            }
        }
    }

    async function probe(name, fn) {
        const t0 = performance.now();
        try {
            const r = await fn();
            const dt = Math.round(performance.now() - t0);
            if (r && r.usable) good(`${name}: OK via ${r.leg} (${dt}ms)`, r.usable);
            else if (r)        warn(`${name}: reachable via ${r.leg} but nothing usable (${dt}ms)`);
            else               warn(`${name}: returned nothing (${dt}ms)`);
        } catch (e) {
            bad(`${name}: FAILED [${e?.leg || 'threw'}] —`, e?.message || e);
        }
    }

    /* ---- 5. Each provider, one at a time ------------------------------- */

    await probe('spotify / color-lyrics', async () => {
        const r = await trace(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&market=from_token`);
        const n = (r.data?.lyrics?.lines || r.data?.lines || []).length;
        return { leg: r.leg, usable: n ? { lines: n, syncType: r.data?.lyrics?.syncType } : null };
    });

    await probe('spotify / wg://', async () => {
        const r = await trace(`wg://lyrics/v1/track/${id}?format=json&market=from_token`);
        const n = (r.data?.lyrics?.lines || r.data?.lines || []).length;
        return { leg: r.leg, usable: n ? { lines: n } : null };
    });

    await probe('spotify / Platform.Lyrics', async () => {
        const r = await Spicetify.Platform?.Lyrics?.getLyrics(t.uri);
        return { leg: 'platform api', usable: r?.lines?.length ? { lines: r.lines.length } : null };
    });

    await probe('lrclib / get (exact)', async () => {
        const r = await trace('https://lrclib.net/api/get?' + new URLSearchParams({
            artist_name: artist, track_name: title, album_name: album,
            duration: String(Math.round(ms / 1000)),
        }));
        return { leg: r.leg, usable: (r.data?.syncedLyrics || r.data?.plainLyrics)
            ? { synced: !!r.data.syncedLyrics, id: r.data.id } : null };
    });

    await probe('lrclib / search (fallback)', async () => {
        const r = await trace('https://lrclib.net/api/search?' + new URLSearchParams({
            artist_name: artist, track_name: title,
        }));
        const list = Array.isArray(r.data) ? r.data : [];
        const best = list.find(x => x.syncedLyrics) || list[0];
        return { leg: r.leg, usable: best
            ? { results: list.length, synced: !!best.syncedLyrics, pickedId: best.id } : null };
    });

    await probe('netease / search', async () => {
        const r = await trace(`https://music.163.com/api/search/get?type=1&limit=5&s=${encodeURIComponent(`${title} ${artist}`)}`);
        const songs = r.data?.result?.songs || [];
        // v2 rejects any hit more than 8s off the real duration.
        const best = songs.slice().sort((a, b) =>
            Math.abs((a.duration || 0) - ms) - Math.abs((b.duration || 0) - ms))[0];
        const drift = best ? Math.abs((best.duration || 0) - ms) : null;
        if (best && ms && drift > 8000) {
            warn(`  netease: closest hit is ${Math.round(drift / 1000)}s off — v2 rejects it (>8s).`);
        }
        return { leg: r.leg, usable: songs.length
            ? { hits: songs.length, bestId: best?.id, driftMs: drift } : null };
    });

    line('Done. Select everything above, copy, and send it over.');
})();
