/* Wave Player — lyrics diagnostic.
   Play a song that definitely has lyrics, then paste this whole file into the
   Spotify devtools console (Ctrl+Shift+I → Console) and press Enter.
   It tests each provider the way Wave Player does and prints why each one
   failed, instead of collapsing everything into "No lyrics available". */

(async () => {
    const line = (...a) => console.log('%c[wave]', 'color:#6cf;font-weight:700', ...a);
    const bad  = (...a) => console.log('%c[wave]', 'color:#f66;font-weight:700', ...a);
    const good = (...a) => console.log('%c[wave]', 'color:#6f6;font-weight:700', ...a);

    // 1. Environment
    line('Spicetify:', !!window.Spicetify,
         '| CosmosAsync:', !!window.Spicetify?.CosmosAsync,
         '| Platform.Lyrics:', !!window.Spicetify?.Platform?.Lyrics);
    line('Extension loaded flag:', !!window.__wavePlayerLoaded);

    const t = Spicetify?.Player?.data?.item;
    if (!t) return bad('No track playing. Start a song and run this again.');

    const title  = t.name || t.metadata?.title || '';
    const artist = t.artists?.map(a => a.name).join(', ') || t.metadata?.artist_name || '';
    const ms     = Number(t.duration?.milliseconds || t.duration_ms || t.metadata?.duration || 0);
    const id     = t.uri.split(':').pop();
    line('Track:', { title, artist, uri: t.uri, durationMs: ms });
    if (!title)  bad('No title in Player.data.item — title/artist providers cannot match.');
    if (!ms)     bad('No duration — lrclib exact-match and netease matching will be weaker.');

    // 2. Saved settings — a provider toggled off in Settings looks identical
    //    to a provider that is broken.
    line('Provider order :', localStorage.getItem('wp7-prov')     || '(default)');
    line('Providers OFF  :', localStorage.getItem('wp7-prov-off') || '(none)');
    line('Musixmatch token set:', !!localStorage.getItem('wp7-mxm'));

    const cos = url => Spicetify.CosmosAsync.get(url);

    async function probe(name, fn) {
        const t0 = performance.now();
        try {
            const r = await fn();
            const dt = Math.round(performance.now() - t0);
            if (r) good(`${name}: OK (${dt}ms)`, r);
            else   bad(`${name}: reachable but returned nothing usable (${dt}ms)`);
        } catch (e) {
            bad(`${name}: THREW —`, e?.message || e, e);
        }
    }

    // 3. Each source, one at a time.
    await probe('spotify/color-lyrics', async () => {
        const r = await cos(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&market=from_token`);
        const n = (r?.lyrics?.lines || r?.lines || []).length;
        return n ? { lines: n, syncType: r?.lyrics?.syncType } : null;
    });

    await probe('spotify/wg', async () => {
        const r = await cos(`wg://lyrics/v1/track/${id}?format=json&market=from_token`);
        const n = (r?.lyrics?.lines || r?.lines || []).length;
        return n ? { lines: n } : null;
    });

    await probe('spotify/Platform.Lyrics', async () => {
        const r = await Spicetify.Platform?.Lyrics?.getLyrics(t.uri);
        return r?.lines?.length ? { lines: r.lines.length } : null;
    });

    await probe('lrclib (via Cosmos)', async () => {
        const r = await cos('https://lrclib.net/api/get?' + new URLSearchParams({
            artist_name: artist, track_name: title,
            album_name: t.album?.name || '', duration: String(Math.round(ms / 1000)),
        }));
        return (r?.syncedLyrics || r?.plainLyrics)
            ? { synced: !!r.syncedLyrics, id: r.id } : null;
    });

    // Same request without Cosmos. If this one works and the Cosmos version
    // above does not, the client stopped proxying third-party hosts and the
    // fix is to stop routing these through Cosmos.
    await probe('lrclib (via fetch)', async () => {
        const res = await fetch('https://lrclib.net/api/get?' + new URLSearchParams({
            artist_name: artist, track_name: title, duration: String(Math.round(ms / 1000)),
        }));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const r = await res.json();
        return (r?.syncedLyrics || r?.plainLyrics)
            ? { synced: !!r.syncedLyrics, id: r.id } : null;
    });

    await probe('netease (via Cosmos)', async () => {
        const s = await cos(`https://music.163.com/api/search/get?type=1&limit=5&s=${encodeURIComponent(`${title} ${artist}`)}`);
        return s?.result?.songs?.length ? { hits: s.result.songs.length } : null;
    });

    line('Done. Copy everything above (right-click → Save as… or select and copy) and send it over.');
})();
