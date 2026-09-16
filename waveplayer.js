// Wave Player — Apple Music style miniplayer for Spicetify.
// Opens a picture-in-picture window with three modes: compact, expanded, lyrics.

(async function WavePlayer() {
    // `spicetify config extensions waveplayer.js` appends, so running it twice
    // loads us twice. Without this the second copy fights the first over the
    // single PiP window and the button appears to do nothing.
    if (window.__wavePlayerLoaded) return;
    window.__wavePlayerLoaded = true;

    // Spicetify injects extensions before its own APIs are ready.
    while (!Spicetify?.Player?.data || !Spicetify?.Platform || !Spicetify?.CosmosAsync) {
        await new Promise(r => setTimeout(r, 100));
    }

    /* Config */

    const SZ = {
        compact:  { w: 460, h: 80  },
        expanded: { w: 390, h: 546 },
        lyrics:   { w: 390, h: 640 },
    };

    // Spicetify has no "you were just updated" hook, so this is the whole
    // mechanism: a version baked into the file, and the last one the user
    // actually saw kept in localStorage. The two differ exactly once per
    // release, on the first Spotify launch after the new file lands.
    //
    // To cut a release: bump VERSION and add a matching entry to the TOP of
    // CHANGELOG. Nothing else in the extension reads either of them, and
    // anyone who skipped a few versions gets every entry since their last.
    //
    // `lead` is optional. When the newest entry has one it runs as a short note
    // above the change list — leave it off for routine releases.
    //
    // A note is either a plain string or a { k, v } pair, which renders as a
    // labelled row. Labels group several related changes under one heading, so
    // the list reads as a spec sheet rather than a wall of sentences.
    const VERSION = 'v2';

    const CHANGELOG = [
        {
            v: 'v2',
            date: 'September 2026',
            lead: 'Hi — sorry about the long wait. Wave Player is finally back, and much better. Here’s everything that’s new.',
            notes: [
                { k: 'Volume', v: 'Vertical slider on the right edge of the lyrics page.' },
                { k: 'Sync',   v: 'Both sliders stay in step with each other and with Spotify.' },
                { k: 'Mute',   v: 'Restores the level you were at.' },
            ],
        },
    ];

    // Keys are still wp7-* so existing installs keep their settings.
    let mode         = localStorage.getItem('wp7-mode')   || 'expanded';
    let centerLyrics = localStorage.getItem('wp7-center') !== 'false';
    let showVol      = localStorage.getItem('wp7-vol')    !== 'false';
    let fontSize     = parseInt(localStorage.getItem('wp7-fs') || '26');

    // Lyric sources, tried in this order. Spotify first because it needs no
    // extra request and always matches the right track; the rest are for the
    // songs it has nothing for, and for word-level timing it never returns.
    const PROVIDERS = ['spotify', 'lrclib', 'netease', 'musixmatch'];

    // Unknown names are dropped and new ones appended, so adding a provider
    // later doesn't strand anyone on a stale saved order.
    const provOrder = (() => {
        const saved = (localStorage.getItem('wp7-prov') || '').split(',').filter(p => PROVIDERS.includes(p));
        return [...saved, ...PROVIDERS.filter(p => !saved.includes(p))];
    })();
    const provOff  = new Set((localStorage.getItem('wp7-prov-off') || '').split(',').filter(Boolean));
    let   mxmToken = localStorage.getItem('wp7-mxm') || '';
    let   karaoke  = localStorage.getItem('wp7-kara') !== 'false';

    /* Runtime state */

    let pipWindow       = null;
    let currentLyrics   = null;
    let currentTrackUri = null;
    let lastDuration    = 0;
    let rafId           = null;
    let lyricReq        = 0;

    // Last value pushed to the DOM, so the render loop can skip no-op writes.
    const prev = { pct: -1, dur: -1, playing: null, heart: null,
                   shuffle: null, repeat: null, vol: -1, idx: -1, word: -1, el: 0 };

    const resetPrev = () => Object.assign(prev, {
        pct: -1, dur: -1, playing: null, heart: null,
        shuffle: null, repeat: null, vol: -1, idx: -1, word: -1, el: 0,
    });

    /* Album art colors */

    const clampC = n => Math.max(0, Math.min(255, Math.round(n)));

    // K-means over a downscaled cover. Returns a dominant color plus a
    // contrasting accent. Samples are weighted toward saturated mid-tones so
    // the accent doesn't collapse to near-black or near-white.
    function buildPalette(data, w, h) {
        const s = [];
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3]/255;
            if (a < 0.2) continue;
            const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
            const sat = mx === 0 ? 0 : (mx-mn)/mx;
            const lum = (0.2126*r + 0.7152*g + 0.0722*b)/255;
            if (lum < 0.02 && sat < 0.08) continue;
            s.push({r,g,b,sat,lum,wt:(0.42+sat*1.35)*(0.35+Math.min(1,lum*1.2))*a});
        }
        if (!s.length) return null;

        s.sort((a,b) => (b.wt*(0.55+b.sat*1.35+(1-Math.abs(b.lum-0.45))*0.4)) -
                        (a.wt*(0.55+a.sat*1.35+(1-Math.abs(a.lum-0.45))*0.4)));

        // Seed up to 4 centroids, rejecting any too close to one already taken.
        const c = [];
        for (const p of s) {
            const ok = !c.some(q => { const dr=q.r-p.r,dg=q.g-p.g,db=q.b-p.b; return dr*dr+dg*dg+db*db < 784; });
            if (ok) c.push({r:p.r,g:p.g,b:p.b});
            if (c.length >= 4) break;
        }
        while (c.length < 2) c.push({r:80,g:80,b:120});

        for (let iter = 0; iter < 4; iter++) {
            const cl = c.map(()=>({r:0,g:0,b:0,w:0}));
            for (const p of s) {
                let bi=0,bd=Infinity;
                for (let i=0;i<c.length;i++) { const dr=c[i].r-p.r,dg=c[i].g-p.g,db=c[i].b-p.b; const d=dr*dr+dg*dg+db*db; if(d<bd){bd=d;bi=i;} }
                cl[bi].r+=p.r*p.wt; cl[bi].g+=p.g*p.wt; cl[bi].b+=p.b*p.wt; cl[bi].w+=p.wt;
            }
            for (let i=0;i<c.length;i++) if(cl[i].w>0.001) c[i]={r:clampC(cl[i].r/cl[i].w),g:clampC(cl[i].g/cl[i].w),b:clampC(cl[i].b/cl[i].w)};
        }

        // Accent = centroid furthest from dominant, biased toward saturation.
        const dom = c[0];
        let acc = dom, best = -1;
        for (const q of c) {
            const dr=q.r-dom.r,dg=q.g-dom.g,db=q.b-dom.b;
            const dist = Math.sqrt(dr*dr+dg*dg+db*db);
            const mx = Math.max(q.r,q.g,q.b);
            const sat = mx===0?0:(mx-Math.min(q.r,q.g,q.b))/mx;
            const sc = sat*1.4+(dist/100)*0.6;
            if (dist>18 && sc>best) { best=sc; acc=q; }
        }

        // The accent has two jobs now: tint the UI, and light the background
        // wash. The wash blends with screen, where a dark color contributes
        // nothing at all, so anything below this floor gets lifted to meet it.
        // Solving lum + (1-lum)*k = FLOOR for k lands exactly on the floor
        // instead of overshooting pale covers.
        const FLOOR = 0.42;
        const aLum = (0.2126*acc.r + 0.7152*acc.g + 0.0722*acc.b)/255;
        if (aLum < FLOOR) acc = shade(acc, (FLOOR - aLum) / (1 - aLum));

        return { dom, acc };
    }

    // Positive k lifts toward white, negative sinks toward black.
    const shade = (q, k) => k > 0
        ? { r: clampC(q.r + (255-q.r)*k), g: clampC(q.g + (255-q.g)*k), b: clampC(q.b + (255-q.b)*k) }
        : { r: clampC(q.r*(1+k)), g: clampC(q.g*(1+k)), b: clampC(q.b*(1+k)) };

    const colorCache = new Map();

    function getColors(url) {
        if (!url) return Promise.resolve(null);
        if (colorCache.has(url)) return Promise.resolve(colorCache.get(url));
        return new Promise(res => {
            const img = new Image();
            // Required, or the canvas is tainted and getImageData throws.
            img.crossOrigin = 'anonymous';
            img.referrerPolicy = 'no-referrer';
            img.onload = () => {
                try {
                    const cv = document.createElement('canvas');
                    cv.width = cv.height = 64;
                    const ctx = cv.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, 64, 64);
                    const p = buildPalette(ctx.getImageData(0, 0, 64, 64).data, 64, 64);
                    if (colorCache.size > 60) colorCache.clear();
                    colorCache.set(url, p);
                    res(p);
                } catch { res(null); }
            };
            img.onerror = () => res(null);
            img.src = url;
        });
    }

    /* Lyrics */

    // Every provider is normalized to this: a start time, a duration, the plain
    // text, and optionally the words with their own timings. `words` is null
    // when the source only syncs whole lines, which is most of them.
    const mkLine = (t, text, words, d) => ({ t: Math.round(t), d: d ?? null, text, words: words || null });

    /* Transport
       Everything used to go through Cosmos, which proxied the request through
       the client and sidestepped CORS. Some builds now answer every
       CosmosAsync call with "Resolver not found!" before a request is even
       made, which takes every provider down at once and reads as "no lyrics".
       So fetch goes first for anything it can handle, and Cosmos stays behind
       it — for wg://, for hosts that send no CORS headers, and for builds
       where fetch is the one that's blocked. */

    // Cosmos attached the client's credentials itself. Doing it by hand for
    // Spotify's own hosts; everything else is an open API and wants no headers
    // at all, which also keeps the request simple enough to skip a preflight.
    function spotifyAuth() {
        const p = Spicetify.Platform;
        const tok = p?.AuthorizationAPI?.getState?.()?.token
                 || p?.Session?.accessToken
                 || p?.AuthorizationAPI?._state?.token;
        return tok ? { Authorization: `Bearer ${tok}`, 'App-Platform': 'WebPlayer' } : null;
    }

    async function viaFetch(url) {
        const spotify = /(^|\.)spotify\.com$/.test(new URL(url).hostname);
        const headers = spotify ? spotifyAuth() : null;
        if (spotify && !headers) throw new Error('no access token');

        const res = await fetch(url, headers ? { headers } : undefined);
        // A real answer, even a 404. Cosmos would only be told the same thing,
        // so don't spend a second request finding that out.
        if (!res.ok) { const e = new Error('HTTP ' + res.status); e.answered = true; throw e; }
        return res.json();
    }

    const cos = async url => {
        // A client-internal scheme fetch knows nothing about.
        if (url.startsWith('wg://')) return Spicetify.CosmosAsync.get(url);
        try {
            return await viaFetch(url);
        } catch (e) {
            if (e?.answered) throw e;
            return Spicetify.CosmosAsync.get(url);
        }
    };

    // Player.data.item changes shape between client versions, so read every
    // field through these instead of reaching into it directly.
    const msOf     = t => Number(t?.duration?.milliseconds || t?.duration_ms || t?.metadata?.duration || 0);
    const secs     = t => Math.round(msOf(t) / 1000);
    const titleOf  = t => t?.name || t?.metadata?.title || '';
    const artistOf = t => t?.artists?.[0]?.name || t?.metadata?.artist_name || '';
    const albumOf  = t => t?.album?.name || t?.metadata?.album_title || '';

    /* Parsers */

    const LINE_TAG = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
    const WORD_TAG = /<(\d+):(\d+)(?:[.:](\d+))?>/g;

    // Fractions are written as .x, .xx or .xxx depending on who produced the
    // file, so pad before reading them as milliseconds.
    const tagMs = (m, s, f) => +m * 60000 + +s * 1000 + (f ? +String(f).padEnd(3, '0').slice(0, 3) : 0);

    // Enhanced LRC puts <mm:ss.xx> before each word. Each tag's text runs until
    // the next tag, so the word is only known once we've seen the one after it.
    function parseWordTags(body) {
        WORD_TAG.lastIndex = 0;
        const raw = [];
        let m, open = null;
        while ((m = WORD_TAG.exec(body))) {
            if (open) open.text = body.slice(open.end, m.index);
            open = { t: tagMs(m[1], m[2], m[3]), end: WORD_TAG.lastIndex, text: '' };
            raw.push(open);
        }
        if (!raw.length) return null;
        open.text = body.slice(open.end);
        const words = raw.map(w => ({ t: w.t, text: w.text })).filter(w => w.text);
        return words.length > 1 ? words : null;
    }

    function parseLrc(text) {
        const out = [];
        for (const raw of text.split(/\r?\n/)) {
            LINE_TAG.lastIndex = 0;
            const stamps = [];
            let m, end = 0;
            // Only leading tags are timestamps; one line can carry several when
            // a chorus repeats.
            while ((m = LINE_TAG.exec(raw)) && m.index === end) {
                stamps.push(tagMs(m[1], m[2], m[3]));
                end = LINE_TAG.lastIndex;
            }
            if (!stamps.length) continue;
            const body  = raw.slice(end);
            const plain = body.replace(WORD_TAG, '').trim();
            if (!plain) continue;
            const words = parseWordTags(body);
            for (const t of stamps) out.push(mkLine(t, plain, words && words.map(w => ({ ...w }))));
        }
        return out.sort((a, b) => a.t - b.t);
    }

    // NetEase yrc: [lineStart,lineLen](wordStart,wordLen,0)word(...)word
    // Some lines are JSON metadata instead; those just don't match the header.
    function parseYrc(text) {
        const head = /^\[(\d+),(\d+)\]/;
        const word = /\((\d+),(\d+),\d+\)([^(]*)/g;
        const out = [];
        for (const raw of text.split(/\r?\n/)) {
            const h = raw.match(head);
            if (!h) continue;
            word.lastIndex = h[0].length;
            const words = [];
            let m;
            while ((m = word.exec(raw))) words.push({ t: +m[1], d: +m[2], text: m[3] });
            const plain = words.map(w => w.text).join('').trim();
            if (plain) out.push(mkLine(+h[1], plain, words.length > 1 ? words : null, +h[2]));
        }
        return out;
    }

    // Musixmatch richsync: per line, ts/te in seconds and word offsets relative
    // to ts. `x` is the line already assembled, which keeps punctuation intact.
    function parseRichsync(raw) {
        let arr;
        try { arr = JSON.parse(raw); } catch { return []; }
        if (!Array.isArray(arr)) return [];
        return arr.map(s => {
            const start = s.ts * 1000, end = s.te * 1000;
            const src = Array.isArray(s.l) ? s.l : [];
            const words = src.map((w, i) => {
                const t = start + w.o * 1000;
                return { t, text: w.c, d: Math.max(60, (src[i + 1] ? start + src[i + 1].o * 1000 : end) - t) };
            }).filter(w => w.text);
            const text = (s.x || words.map(w => w.text).join('')).trim();
            return text ? mkLine(start, text, words.length > 1 ? words : null, end - start) : null;
        }).filter(Boolean);
    }

    /* Providers */

    // color-lyrics is the client's own endpoint; wg:// is the older route some
    // builds still answer on. Platform.Lyrics is the last resort.
    async function fromSpotify(track) {
        const id = track.uri.split(':').pop();
        const norm = lines => lines
            .map(l => mkLine(parseInt(l.startTimeMs || l.time || 0), (l.words || l.text || '').trim()))
            .filter(l => l.text && l.text !== '♪');

        for (const url of [
            `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&market=from_token`,
            `wg://lyrics/v1/track/${id}?format=json&market=from_token`,
        ]) {
            try {
                const r = await cos(url);
                const lines = r?.lyrics?.lines || r?.lines;
                if (lines?.length) return {
                    synced: r?.lyrics?.syncType !== 'UNSYNCED',
                    lines: norm(lines),
                };
            } catch {}
        }
        try {
            const r = await Spicetify.Platform?.Lyrics?.getLyrics(track.uri);
            if (r?.lines?.length) return { synced: true, lines: norm(r.lines) };
        } catch {}
        return null;
    }

    // LRCLIB is free and open to third-party clients. The exact-match lookup
    // wants the duration, so fall back to search when it comes up empty.
    async function fromLrclib(track) {
        const base = { artist_name: artistOf(track), track_name: titleOf(track) };
        if (!base.track_name) return null;

        let hit = null;
        try {
            hit = await cos('https://lrclib.net/api/get?' + new URLSearchParams({
                ...base, album_name: albumOf(track), duration: String(secs(track)),
            }));
        } catch {}
        if (!hit?.syncedLyrics && !hit?.plainLyrics) {
            try {
                const list = await cos('https://lrclib.net/api/search?' + new URLSearchParams(base));
                if (Array.isArray(list)) hit = list.find(x => x.syncedLyrics) || list[0];
            } catch {}
        }

        if (hit?.syncedLyrics) {
            const lines = parseLrc(hit.syncedLyrics);
            if (lines.length) return { synced: true, lines };
        }
        if (hit?.plainLyrics) {
            const lines = hit.plainLyrics.split(/\r?\n/).filter(s => s.trim()).map(s => mkLine(0, s.trim()));
            if (lines.length) return { synced: false, lines };
        }
        return null;
    }

    // The only free source that hands back real word-level timing. Search has
    // no duration filter, so pick whichever result is closest in length.
    async function fromNetease(track) {
        const q = `${titleOf(track)} ${artistOf(track)}`.trim();
        if (!q) return null;

        let songs;
        try {
            const s = await cos(`https://music.163.com/api/search/get?type=1&limit=5&s=${encodeURIComponent(q)}`);
            songs = s?.result?.songs;
        } catch { return null; }
        if (!songs?.length) return null;

        const want = msOf(track);
        const best = songs.slice().sort((a, b) =>
            Math.abs((a.duration || 0) - want) - Math.abs((b.duration || 0) - want))[0];
        if (want && Math.abs((best.duration || 0) - want) > 8000) return null;

        let l;
        try {
            l = await cos(`https://music.163.com/api/song/lyric/v1?id=${best.id}&cp=false&tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0`);
        } catch { return null; }

        if (l?.yrc?.lyric) {
            const lines = parseYrc(l.yrc.lyric);
            if (lines.length) return { synced: true, lines };
        }
        if (l?.lrc?.lyric) {
            const lines = parseLrc(l.lrc.lyric);
            if (lines.length) return { synced: true, lines };
        }
        return null;
    }

    // Needs a user token pasted in Settings, so it stays last and silently
    // does nothing until someone supplies one.
    async function fromMusixmatch(track) {
        if (!mxmToken || !titleOf(track)) return null;
        const qs = new URLSearchParams({
            format: 'json', app_id: 'web-desktop-app-v1.0', usertoken: mxmToken,
            namespace: 'lyrics_richsynched', subtitle_format: 'lrc',
            q_track: titleOf(track), q_artist: artistOf(track), q_duration: String(secs(track)),
            optional_calls: 'track.richsync',
        });

        let calls;
        try {
            const r = await cos(`https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?${qs}`);
            calls = r?.message?.body?.macro_calls;
        } catch { return null; }
        if (!calls) return null;

        const rich = calls['track.richsync.get']?.message?.body?.richsync?.richsync_body;
        if (rich) {
            const lines = parseRichsync(rich);
            if (lines.length) return { synced: true, lines };
        }
        const sub = calls['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
        if (sub) {
            const lines = parseLrc(sub);
            if (lines.length) return { synced: true, lines };
        }
        return null;
    }

    const SOURCES = {
        spotify: fromSpotify, lrclib: fromLrclib,
        netease: fromNetease, musixmatch: fromMusixmatch,
    };

    /* Dispatch */

    // A line's duration is the gap to the next one; a word's is the gap to the
    // next word, or to the end of its line. Sources fill in whichever of these
    // they happen to know, so everything missing is derived here once.
    function fillGaps(lines) {
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (l.d == null) l.d = lines[i + 1] ? Math.max(0, lines[i + 1].t - l.t) : 6000;
            if (!l.words?.length) { l.words = null; continue; }
            for (let j = 0; j < l.words.length; j++) {
                const w = l.words[j];
                if (w.d == null) w.d = Math.max(60, (l.words[j + 1] ? l.words[j + 1].t : l.t + l.d) - w.t);
            }
        }
    }

    const lyricCache = new Map();

    // A miss is usually the providers being briefly unreachable — a rotating
    // Spotify token, a rate limit, a request that went out before the track
    // metadata landed — not proof the song has no lyrics. Caching that forever
    // freezes "No lyrics available" onto a track for the rest of the session,
    // so misses get a short life and hits are kept indefinitely.
    const MISS_TTL = 60e3;

    // Walks the user's provider order and takes the first synced result. Plain
    // text is held back as a fallback, since a later provider may still be
    // synced and that's always the better answer.
    async function fetchLyrics(track) {
        const hit = lyricCache.get(track.uri);
        if (hit && (hit.result || Date.now() - hit.at < MISS_TTL)) return hit.result;

        let fallback = null;
        for (const name of provOrder) {
            if (provOff.has(name)) continue;
            let r = null;
            try { r = await SOURCES[name](track); } catch {}
            if (!r?.lines?.length) continue;

            r.provider = name;
            fillGaps(r.lines);
            r.karaoke = r.lines.some(l => l.words);
            if (r.synced) { remember(track.uri, r); return r; }
            fallback = fallback || r;
        }
        remember(track.uri, fallback);
        return fallback;
    }

    function remember(uri, result) {
        if (lyricCache.size > 40) lyricCache.clear();
        lyricCache.set(uri, { result, at: Date.now() });
    }

    /* Utils */

    const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

    const fmt = ms => {
        if (!ms || !isFinite(ms) || ms < 0) return '0:00';
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
    };

    /* Icons */

    const H_FILL = '<path d="M15.724 4.22A4.313 4.313 0 0 0 12.192.814a4.269 4.269 0 0 0-3.622 1.13.837.837 0 0 1-1.14 0 4.272 4.272 0 0 0-6.21 5.855l5.916 7.05a1.128 1.128 0 0 0 1.727 0l5.916-7.05a4.228 4.228 0 0 0 .945-3.577z"/>';
    const H_LINE = '<path d="M1.69 2A4.582 4.582 0 0 1 8 2.023 4.583 4.583 0 0 1 11.88.817h.002a4.618 4.618 0 0 1 3.782 3.65v.003a4.543 4.543 0 0 1-1.011 3.84L9.35 14.629a1.765 1.765 0 0 1-2.093.464 1.762 1.762 0 0 1-.605-.463L1.348 8.309A4.582 4.582 0 0 1 1.689 2zm3.158.252A3.082 3.082 0 0 0 2.49 7.337l.005.005L7.8 13.664a.264.264 0 0 0 .311.069.262.262 0 0 0 .09-.069l5.312-6.33a3.043 3.043 0 0 0 .68-2.573 3.118 3.118 0 0 0-2.551-2.463 3.079 3.079 0 0 0-2.612.816l-.007.007a1.501 1.501 0 0 1-2.045 0l-.009-.008a3.082 3.082 0 0 0-2.121-.861z"/>';

    const I_PREV    = '<svg viewBox="0 0 16 16"><path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-.7.7H1.7a.7.7 0 0 1-.7-.7V1.7a.7.7 0 0 1 .7-.7h1.6z"/></svg>';
    const I_NEXT    = '<svg viewBox="0 0 16 16"><path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-1.6z"/></svg>';
    const I_SHUFFLE = '<svg viewBox="0 0 16 16"><path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06l2.306-2.306a.75.75 0 0 0 0-1.06L13.15.922zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"/><path d="m7.5 10.723.98-1.167 1.796 2.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.306 2.306a.75.75 0 0 1 0 1.06l-2.306 2.306a.75.75 0 1 1-1.06-1.06L14.109 14H12.16a3.75 3.75 0 0 1-2.873-1.34l-1.787-2.14z"/></svg>';
    const I_REPEAT  = '<svg viewBox="0 0 16 16"><path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L7.617 13.426a.75.75 0 0 1 0-1.06l2.15-2.152a.75.75 0 1 1 1.062 1.06l-.966.967h1.887A2.25 2.25 0 0 0 14.5 9.75v-5A2.25 2.25 0 0 0 12.25 2.5h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 11.5H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75v-5z"/></svg>';
    const I_PLAY    = '<path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/>';
    const I_PAUSE   = '<path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7H2.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-2.6z"/>';
    const I_LYRICS  = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>';
    const I_GEAR    = '<svg viewBox="0 0 20 20"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 0 1-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 0 1 .947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 0 1 2.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 0 1 2.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 0 1 .947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 0 1-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 0 1-2.287-.947zM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" clip-rule="evenodd"/></svg>';
    const I_CLOSE   = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    const I_EXPAND  = '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
    const I_COLLAPSE= '<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>';
    const I_PLAYER  = '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
    const I_NO_LYR  = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';

    // Speaker glyph changes with level: muted / low / high.
    function vIco(v) {
        if(v===0) return `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.86 5.47a.75.75 0 0 0-1.061 0l-1.47 1.47-1.47-1.47A.75.75 0 0 0 8.8 6.53L10.269 8l-1.47 1.47a.75.75 0 1 0 1.06 1.06l1.47-1.47 1.47 1.47a.75.75 0 0 0 1.06-1.06L12.39 8l1.47-1.47a.75.75 0 0 0 0-1.06z"/><path d="M10.116 1.5A.75.75 0 0 0 8.991.85l-6.925 4a3.642 3.642 0 0 0-1.33 4.967 3.639 3.639 0 0 0 1.33 1.332l6.925 4a.75.75 0 0 0 1.125-.649v-1.906a4.73 4.73 0 0 1-1.5-.694v1.3L2.817 9.852a2.141 2.141 0 0 1-.781-2.92c.187-.324.456-.594.78-.782l5.8-3.35v1.3c.45-.313.956-.55 1.5-.694V1.5z"/></svg>`;
        if(v<50) return `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4a3.642 3.642 0 0 1-1.33-4.967 3.639 3.639 0 0 1 1.33-1.332l6.925-4a.75.75 0 0 1 .75 0zm-6.924 5.3a2.139 2.139 0 0 0 0 3.7l5.8 3.35V2.8l-5.8 3.35zm8.683 4.29V5.56a2.75 2.75 0 0 1 0 4.88z"/></svg>`;
        return `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4a3.642 3.642 0 0 1-1.33-4.967 3.639 3.639 0 0 1 1.33-1.332l6.925-4a.75.75 0 0 1 .75 0zm-6.924 5.3a2.139 2.139 0 0 0 0 3.7l5.8 3.35V2.8l-5.8 3.35zm8.683 6.087a4.502 4.502 0 0 0 0-8.474v1.65a2.999 2.999 0 0 1 0 5.175v1.649z"/></svg>`;
    }

    // Film grain as an inline SVG noise tile.
    const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

    /* Styles */

    const CSS = `
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html{height:100%}
    /* Accent must live on :root, which is where applyPalette writes it. Declared
       on body it would beat the inherited value and stay pinned to the default. */
    :root{--accent:#fc3c44;--accent-glow:rgba(252,60,68,.32);}
    body{
        font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI Variable Display','Segoe UI','Helvetica Neue',sans-serif;
        color:#fff;background:#0a0a0c;height:100%;overflow:hidden;
        -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
        --heart:#ff5c5c;
        --glass:rgba(255,255,255,.07);--glass-hi:rgba(255,255,255,.13);
        --hairline:rgba(255,255,255,.12);
        --txt-2:rgba(255,255,255,.62);--txt-3:rgba(255,255,255,.42);
        animation:bodyIn .35s ease;
    }
    @keyframes bodyIn{from{opacity:0}to{opacity:1}}

    /* Idle fade
       In the immersive layout nothing frames the controls, so they'd sit on
       the artwork permanently. Instead they recede when the pointer has been
       still for a few seconds and come back the moment it moves. Lyrics and
       artwork never fade — only chrome does. */
    .chrome{transition:opacity .5s ease,transform .5s cubic-bezier(.3,.9,.4,1);}
    body.idle .chrome{opacity:0;transform:translateY(8px);pointer-events:none;}
    /* Anything open and interactive outranks the idle timer. */
    body.idle.pinned .chrome{opacity:1;transform:none;pointer-events:auto;}
    /* The compact bar is horizontal, so the drop-away gesture doesn't read
       there. The faded buttons deliberately stay a no-drag hole: a drag region
       is hit-tested by the OS and never dispatches mousemove into the page, so
       making that strip draggable would mean hovering the buttons couldn't
       bring them back. */
    body.idle #compact .cbtns{transform:none;}
    @media (prefers-reduced-motion:reduce){
        .chrome{transition:opacity .5s ease}
        body.idle .chrome{transform:none}
    }

    /* Background
       The artwork itself is the background: blown up well past the frame,
       blurred until it's only color and shape, and drifting. Extracting colors
       and painting abstract shapes was the old approach and it collapsed to
       flat black on dark covers, because four centroids off a dark photo are
       four blacks. An image can't collapse that way — there is always
       something there to move and catch light.

       The blur and the motion deliberately live on two different elements.
       A transform animation on a blurred element makes the compositor redo
       the blur every frame, which on a layer this size is what turns the
       drift into a stutter. With the filter on a child instead, the blurred
       result rasterizes once and only the parent's transform animates. */
    #bgWrap{position:fixed;inset:0;z-index:0;overflow:hidden;}
    .bgl{position:absolute;inset:0;opacity:0;transition:opacity 1s ease;
        will-change:transform;animation:drift 44s ease-in-out infinite alternate;}
    .bgl.show{opacity:1;}
    .bgi{position:absolute;inset:-28%;background-size:cover;background-position:center;
        filter:blur(52px) saturate(2) brightness(.66);}
    /* Offset so the two layers never drift in lockstep. */
    #bgB{animation-delay:-22s;}
    /* Translation as well as scale, so the motion reads as the image moving
       past the window rather than the window breathing. Rotation is gone:
       it forced a re-raster of the blurred child on every frame. */
    @keyframes drift{
        0%{transform:scale(1.06) translate3d(-2.5%,-1.5%,0)}
        100%{transform:scale(1.2) translate3d(3%,2%,0)}
    }

    /* A wash of the extracted accent on top. On a saturated cover this barely
       registers; on a grey or near-black one it's the only color in the frame,
       which is what keeps monochrome artwork from going dead. Radial gradients
       are soft to begin with, so no blur filter here either. */
    #bgTint{position:absolute;inset:-20%;mix-blend-mode:screen;
        opacity:0;transition:opacity .5s ease;will-change:transform;
        background:
            radial-gradient(60% 55% at 22% 18%,var(--accent) 0%,transparent 62%),
            radial-gradient(58% 62% at 82% 78%,var(--accent) 0%,transparent 66%);
        animation:tint 52s ease-in-out infinite alternate;}
    #bgTint.show{opacity:.5;}
    @keyframes tint{
        0%{transform:translate3d(-6%,4%,0) scale(1)}
        100%{transform:translate3d(7%,-5%,0) scale(1.22)}
    }

    /* Motion follows the music: when it stops, so does the background. */
    body.stopped .bgl,body.stopped #bgTint{animation-play-state:paused;}

    @media (prefers-reduced-motion:reduce){
        .bgl{animation:none}
        #bgTint{animation:none}
    }
    /* A soft vignette and a gentle ramp into the bottom, plus a cool wash off
       the top. Deliberately light: the glass panels do their own darkening, so
       a heavy scrim under them only sinks the card into a black well. */
    #ov{position:fixed;inset:0;z-index:1;pointer-events:none;
        background:
            radial-gradient(120% 90% at 50% -10%,rgba(255,255,255,.07),transparent 55%),
            radial-gradient(118% 78% at 50% 50%,transparent 38%,rgba(0,0,0,.4) 100%),
            linear-gradient(180deg,rgba(0,0,0,.22) 0%,rgba(0,0,0,.1) 30%,rgba(0,0,0,.34) 72%,rgba(0,0,0,.56) 100%);}
    /* No blend mode. This faint it looks near enough the same either way, and
       a full-window blend forces the compositor to read back everything
       underneath it on every frame the background moves. */
    #grain{position:fixed;inset:0;z-index:2;pointer-events:none;opacity:.055;
        background-image:${GRAIN};background-size:160px 160px;}

    #root{position:relative;z-index:10;height:100%;display:flex;flex-direction:column;overflow:hidden;}

    /* Marquee
       Long titles scroll instead of truncating. JS sets --mqx/--mqd per title. */
    .mqwrap{overflow:hidden;white-space:nowrap;max-width:100%;
        -webkit-mask-image:linear-gradient(90deg,#000 0,#000 92%,transparent);
        mask-image:linear-gradient(90deg,#000 0,#000 92%,transparent);}
    .mq{display:inline-block;white-space:nowrap;will-change:transform;}
    .mq.scroll{animation:mq var(--mqd,9s) linear 2.2s infinite alternate;}
    @keyframes mq{from{transform:translateX(0)}to{transform:translateX(var(--mqx,0))}}
    @media (prefers-reduced-motion:reduce){.mq.scroll{animation:none}}

    /* Compact bar
       Artwork and title travel together as one group, and the buttons are
       taken out of flow on the right — the same arrangement as expanded mode,
       turned on its side. That lets the group centre itself in the whole
       window once the chrome fades, and slide back out of the buttons' way
       when it returns. No progress line: at 460 x 80 there is only room for
       one thing to be the subject, and that is the track. */
    #compact{
        display:flex;align-items:center;justify-content:center;
        height:100%;padding:0 14px;
        -webkit-app-region:drag;app-region:drag;overflow:hidden;position:relative;
    }
    /* The whole bar drags the window, so children have to opt out. */
    #compact *{-webkit-app-region:no-drag;app-region:no-drag;}
    /* Shifted by half the button block so the group sits centred in what is
       actually left; transform rather than margin, because margin re-runs
       layout every frame and the title's marquee is measured off that width.
       The max-width stays fixed across both states for the same reason — the
       group slides, it never resizes, so the marquee measurement holds. */
    #cGroup{display:flex;align-items:center;gap:13px;min-width:0;
        max-width:calc(100% - var(--cbw,220px) - 13px);
        will-change:transform;
        transform:translate3d(calc((var(--cbw,220px) + 13px) / -2),0,0);
        transition:transform .5s cubic-bezier(.3,.9,.4,1);}
    body.idle #cGroup{transform:none;}
    body.idle.pinned #cGroup{transform:translate3d(calc((var(--cbw,220px) + 13px) / -2),0,0);}
    @media (prefers-reduced-motion:reduce){#cGroup{transition:none}}
    .ca{width:52px;height:52px;flex-shrink:0;border-radius:10px;object-fit:cover;
        box-shadow:0 6px 18px rgba(0,0,0,.55),0 0 0 .5px rgba(255,255,255,.12);
        transition:transform .45s cubic-bezier(.34,1.56,.64,1);}
    .ca.paused{transform:scale(.9);}
    .ci{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:2px;}
    .ct{font-size:14px;font-weight:650;letter-spacing:-.02em;line-height:1.2;}
    .cr{font-size:11.5px;font-weight:500;color:rgba(255,255,255,.5);letter-spacing:-.005em;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

    /* Transport and the utility icons are separate groups: the gap between
       them does the grouping, so neither needs a border or a container.
       Pinned to the right edge and out of flow so #cGroup can centre against
       the full window rather than against whatever these leave over. Stretched
       top to bottom instead of centred with a translate, because .chrome
       already owns transform on this element. */
    .cbtns{position:absolute;right:14px;top:0;bottom:0;
        display:flex;align-items:center;gap:5px;}
    /* The transport gets its own glass pill so the three buttons read as one
       control at this size; the utility icons beside it stay loose. */
    .cpill{display:flex;align-items:center;gap:1px;padding:3px;border-radius:999px;
        position:relative;margin-right:7px;background:rgba(255,255,255,.07);
        backdrop-filter:blur(24px) saturate(1.6);
        -webkit-backdrop-filter:blur(24px) saturate(1.6);
        box-shadow:inset 0 0 0 .5px rgba(255,255,255,.09);}
    .cb{background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
        width:30px;height:30px;border-radius:50%;color:rgba(255,255,255,.8);padding:0;
        transition:color .14s,background .14s,transform .12s cubic-bezier(.34,1.56,.64,1);}
    .cb:hover{color:#fff;background:var(--glass);}
    .cb:active{transform:scale(.86);}
    .cb svg{fill:currentColor;width:15px;height:15px;display:block;
        filter:drop-shadow(0 1px 3px rgba(0,0,0,.4));}
    .cb.cplay{width:36px;height:36px;color:#fff;background:var(--glass-hi);
        box-shadow:inset 0 0 0 .5px rgba(255,255,255,.1),
                   inset 0 .5px 0 rgba(255,255,255,.16);}
    .cb.cplay svg{width:18px;height:18px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45));}
    .cb.cplay:hover{background:rgba(255,255,255,.2);}
    .cb.csec{width:28px;height:28px;border-radius:9px;color:var(--txt-3);}
    .cb.csec svg{width:14px;height:14px;}
    .cb.csec:hover{color:#fff;background:var(--glass);}
    .cb.hon{color:var(--heart) !important;}

    /* Drag handle */
    .dh{height:26px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
        cursor:grab;-webkit-app-region:drag;app-region:drag;}
    .dh:active{cursor:grabbing;}
    .dp{width:36px;height:4.5px;border-radius:3px;background:rgba(255,255,255,.22);
        box-shadow:0 .5px 0 rgba(255,255,255,.1) inset;}

    /* Expanded mode
       The drag handle and the control card are both out of flow, so the only
       things laid out are the artwork and the title — which lets them center
       as a group, and the control card is taken out of flow underneath them.

       #stage centres the pair in the whole window, then lifts them by half the
       card's height while the chrome is up, which centres them in the space
       that is actually left. It moves with a transform rather than padding:
       animating padding re-runs layout on every frame, and with a blurred
       background behind it that is what makes the whole thing stutter. The
       card height is measured at runtime into --ctrlh, because the volume row
       is optional and the footer can wrap. */
    #expanded{height:100%;overflow:hidden;position:relative;}
    #stage{position:absolute;inset:0;display:flex;flex-direction:column;
        justify-content:center;will-change:transform;
        transform:translate3d(0,calc(var(--ctrlh,152px) / -2),0);
        transition:transform .55s cubic-bezier(.3,.9,.4,1);}
    body.idle #stage{transform:none;}
    body.idle.pinned #stage{transform:translate3d(0,calc(var(--ctrlh,152px) / -2),0);}
    @media (prefers-reduced-motion:reduce){#stage{transition:none}}
    #expanded .dh{position:absolute;top:0;left:0;right:0;z-index:2;}

    #artSec{flex:0 0 auto;padding:0 28px 14px;
        display:flex;align-items:center;justify-content:center;
        -webkit-app-region:drag;app-region:drag;}
    /* Width-driven rather than height-driven: aspect-ratio then derives the
       height, which keeps the box definite so justify-content can center it.
       The vh term is what shrinks the art on a short window. */
    .af{position:relative;aspect-ratio:1;width:min(318px,42vh,100%);}
    #artImg{width:100%;height:100%;object-fit:cover;border-radius:18px;display:block;
        -webkit-app-region:no-drag;app-region:no-drag;will-change:transform;
        transition:transform .55s cubic-bezier(.34,1.56,.64,1),box-shadow .55s ease;}
    #artImg.playing{transform:scale(1);
        box-shadow:0 30px 72px rgba(0,0,0,.74),0 12px 30px rgba(0,0,0,.52),
                   0 0 64px var(--accent-glow),0 0 0 .5px rgba(255,255,255,.14),
                   inset 0 0 0 .5px rgba(255,255,255,.1);}
    #artImg.paused{transform:scale(.9);
        box-shadow:0 12px 34px rgba(0,0,0,.5),0 0 0 .5px rgba(255,255,255,.08);}

    #infoSec{flex:0 0 auto;padding:0 24px 2px;-webkit-app-region:no-drag;app-region:no-drag;}
    .ir{display:flex;align-items:center;gap:10px;}
    .it{flex:1;min-width:0;}

    /* With the chrome up the title centres under the artwork and the two pull
       apart; idle puts it back left and tucked in close. The gap opens as a
       transform on each half rather than as margin, so it stays off the layout
       path, and splitting it between them keeps the pair optically centred
       instead of dropping the whole group. The ::before mirrors the heart
       button on the empty side, so "centred" means centred in the window and
       not centred in whatever the heart leaves over. */
    #artSec,#infoSec{transition:transform .55s cubic-bezier(.3,.9,.4,1);}
    body:not(.idle) #artSec,body.idle.pinned #artSec{transform:translate3d(0,-9px,0);}
    body:not(.idle) #infoSec,body.idle.pinned #infoSec{transform:translate3d(0,9px,0);}
    /* Centred in both states. The ::before mirrors the heart button on the
       empty side so "centred" means centred under the artwork rather than
       centred in whatever the heart leaves over — and it stays there when the
       heart fades, because a hidden heart still takes up its 38px. */
    #infoSec .it{text-align:center;}
    #infoSec .ir::before{content:'';width:38px;flex-shrink:0;}
    @media (prefers-reduced-motion:reduce){#artSec,#infoSec{transition:none}}
    .etitle{font-size:18px;font-weight:700;letter-spacing:-.022em;line-height:1.22;}
    .eartist{font-size:14px;font-weight:500;color:var(--txt-2);letter-spacing:-.01em;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}
    .hb{background:none;border:none;cursor:pointer;flex-shrink:0;width:38px;height:38px;
        display:flex;align-items:center;justify-content:center;border-radius:12px;
        color:rgba(255,255,255,.45);
        transition:color .15s,background .15s,opacity .5s ease,
                   transform .15s cubic-bezier(.34,1.56,.64,1);}
    /* A control, not information, so it goes with the rest of the chrome.
       Handled here rather than with the .chrome class because .hb needs to
       keep its own press transition. */
    body.idle .hb{opacity:0;pointer-events:none;}
    body.idle.pinned .hb{opacity:1;pointer-events:auto;}
    .hb:hover{color:#fff;background:var(--glass);}
    .hb:active{transform:scale(.8);}
    .hb svg{fill:currentColor;width:19px;height:19px;display:block;}
    .hb.liked{color:var(--heart);}

    /* Liquid Glass control card. A frosted panel floating clear of the window
       edges, so the blurred artwork reads through it and the controls sit on
       something rather than on the picture. Kept out of flow so the artwork
       above can centre itself in the whole window when the chrome is hidden;
       #stage lifts clear of it by half of --ctrlh while the chrome is up, and
       the inset offsets are what give it the floating card shape. */
    #ctrlCard{
        position:absolute;left:12px;right:12px;bottom:12px;padding:10px 16px 8px;
        background:rgba(18,18,22,.36);border-radius:24px;
        backdrop-filter:blur(40px) saturate(1.7);
        -webkit-backdrop-filter:blur(40px) saturate(1.7);
        box-shadow:0 18px 44px rgba(0,0,0,.48),0 2px 10px rgba(0,0,0,.28),
                   inset 0 0 0 .5px rgba(255,255,255,.05);
        -webkit-app-region:no-drag;app-region:no-drag;
    }
    /* The lit top edge. A hairline border all the way round reads as a box;
       a gradient that fades out at both ends reads as light catching glass. */
    #ctrlCard::before,#lyrHeader::before,#lyrCtrl::before{
        content:'';position:absolute;top:0;left:16%;right:16%;height:1px;
        border-radius:1px;pointer-events:none;
        background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);
    }

    /* Knobless scrubber that thickens on hover. */
    #progSec{flex:0 0 auto;padding:2px 8px 0;-webkit-app-region:no-drag;app-region:no-drag;}
    .pw{position:relative;height:18px;cursor:pointer;display:flex;align-items:center;}
    .pt{flex:1;height:5px;background:rgba(255,255,255,.2);border-radius:4px;overflow:hidden;
        transition:height .2s ease,background .2s ease;}
    .pw:hover .pt,.pw:active .pt{height:8px;background:rgba(255,255,255,.26);}
    .pf{height:100%;background:rgba(255,255,255,.9);border-radius:4px;}
    .times{display:flex;justify-content:space-between;margin-top:5px;}
    .tm{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--txt-3);
        font-variant-numeric:tabular-nums;transition:color .2s;}
    .pw:hover ~ .times .tm{color:rgba(255,255,255,.62);}

    /* Transport
       Bare glyphs that grow a soft glass pill under the cursor — the pill only
       exists while you're pointing at it, so the row stays quiet at rest. */
    #ctrlSec{flex:0 0 auto;padding:0 8px;-webkit-app-region:no-drag;app-region:no-drag;}
    .ctrlrow{display:flex;align-items:center;justify-content:space-between;}
    .eb{background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
        color:rgba(255,255,255,.92);position:relative;padding:0;border-radius:13px;
        transition:color .14s,background .14s,opacity .16s,
                   transform .13s cubic-bezier(.34,1.56,.64,1);}
    .eb:hover{background:var(--glass);}
    .eb:active{transform:scale(.8);}
    .eb svg{fill:currentColor;display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,.35));}
    /* Shuffle and repeat sit a tier below the transport: smaller, dimmer, and
       only fully lit when they're actually on. */
    .eb.sm{width:40px;height:40px;color:rgba(255,255,255,.6);} .eb.sm svg{width:17px;height:17px;}
    .eb.sm:hover{color:#fff;}
    .eb.md{width:50px;height:50px;} .eb.md svg{width:26px;height:26px;}
    .eb.on{color:var(--accent) !important;}
    /* Play is the biggest glyph rather than a filled disc: on glass the size
       difference is enough to make it the landing spot, and a white circle
       would be the one opaque thing in the whole card. */
    .eplay{width:62px !important;height:62px !important;}
    .eplay svg{width:34px !important;height:34px !important;
        filter:drop-shadow(0 3px 9px rgba(0,0,0,.5)) !important;}
    /* Marks repeat-one on the repeat button and smart shuffle on the shuffle
       one. Both already light up via .on, so this only has to distinguish the
       two active states. */
    .rbadge{position:absolute;top:5px;right:5px;width:12px;height:12px;border-radius:50%;
        background:var(--accent);color:#000;font-size:8px;font-weight:800;line-height:12px;
        text-align:center;display:none;}
    .eb.r1 .rbadge,.lb.r1 .rbadge,.eb.smart .rbadge,.lb.smart .rbadge{display:block;}

    /* Volume
       Native thumb is hidden and only revealed on hover; the fill is painted
       onto the track background by JS. */
    #volSec{flex:0 0 auto;padding:2px 8px 6px;display:flex;align-items:center;gap:11px;
        -webkit-app-region:no-drag;app-region:no-drag;}
    .vb{background:none;border:none;cursor:pointer;color:var(--txt-3);
        width:20px;height:20px;display:flex;align-items:center;justify-content:center;
        transition:color .14s;flex-shrink:0;padding:0;}
    .vb:hover{color:#fff;}
    .vb svg{width:14px;height:14px;}
    .vs{-webkit-appearance:none;appearance:none;flex:1;height:5px;border-radius:4px;
        background:linear-gradient(90deg,rgba(255,255,255,.9) 0%,rgba(255,255,255,.16) 0%);
        outline:none;cursor:pointer;transition:height .18s ease;}
    .vs:hover{height:7px;}
    .vs::-webkit-slider-thumb{-webkit-appearance:none;width:0;height:0;}
    .vs:hover::-webkit-slider-thumb{width:11px;height:11px;border-radius:50%;background:#fff;
        box-shadow:0 1px 5px rgba(0,0,0,.45);cursor:pointer;}
    /* Fixed width and tabular figures so the slider doesn't resize as the
       number goes from one digit to three. */
    .vpct{flex-shrink:0;min-width:31px;text-align:right;
        font-size:10px;font-weight:500;letter-spacing:.03em;
        color:rgba(255,255,255,.38);font-variant-numeric:tabular-nums;
        transition:color .15s;}
    #volSec:hover .vpct{color:rgba(255,255,255,.72);}

    /* Expanded footer
       Text label on the left, icons on the right, both at the same low weight
       so the row sits under the transport rather than beside it. */
    #expFooter{
        flex:0 0 auto;margin-top:4px;padding:4px 2px 0;
        display:flex;align-items:center;justify-content:space-between;
        border-top:1px solid rgba(255,255,255,.06);
        -webkit-app-region:no-drag;app-region:no-drag;
    }
    .foot-btn{background:none;border:none;cursor:pointer;display:flex;align-items:center;
        color:var(--txt-3);font-size:11px;font-weight:700;text-transform:uppercase;
        letter-spacing:.12em;padding:7px 11px;border-radius:11px;
        transition:color .15s,background .15s;}
    .foot-btn:hover{color:#fff;background:var(--glass-hi);}
    .foot-icon{background:none;border:none;cursor:pointer;width:30px;height:30px;
        display:flex;align-items:center;justify-content:center;padding:0;border-radius:10px;
        color:var(--txt-3);transition:color .15s,background .15s;}
    .foot-icon:hover{color:#fff;background:var(--glass-hi);}
    .foot-icon svg{fill:currentColor;width:14px;height:14px;}

    /* Lyrics mode */
    #lyrMode{display:flex;flex-direction:column;height:100%;overflow:hidden;}

    /* Same glass as the control card, one step lighter — it's a header, so it
       sits on the lyrics rather than over them. */
    #lyrHeader{
        flex:0 0 auto;margin:8px 12px 2px;padding:9px 14px;
        display:flex;align-items:center;gap:11px;position:relative;
        background:rgba(18,18,22,.32);border-radius:20px;
        backdrop-filter:blur(36px) saturate(1.7);
        -webkit-backdrop-filter:blur(36px) saturate(1.7);
        box-shadow:0 10px 30px rgba(0,0,0,.32),inset 0 0 0 .5px rgba(255,255,255,.05);
        -webkit-app-region:drag;app-region:drag;
    }
    #lyrHeader *{-webkit-app-region:no-drag;app-region:no-drag;}
    #lyrArtThumb{
        width:42px;height:42px;flex-shrink:0;border-radius:10px;object-fit:cover;
        box-shadow:0 4px 14px rgba(0,0,0,.5),0 0 0 .5px rgba(255,255,255,.12);
    }
    #lyrHeader .it{flex:1;min-width:0;}
    .lyrtitle{font-size:14px;font-weight:700;letter-spacing:-.015em;line-height:1.25;}
    #lyrArtist{font-size:12px;color:var(--txt-2);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}
    .lyrh-btn{background:none;border:none;cursor:pointer;width:32px;height:32px;padding:0;
        border-radius:10px;display:flex;align-items:center;justify-content:center;
        color:var(--txt-3);transition:color .15s,background .15s,transform .13s;}
    .lyrh-btn:hover{color:#fff;background:var(--glass);}
    .lyrh-btn:active{transform:scale(.86);}
    .lyrh-btn svg{fill:currentColor;width:16px;height:16px;display:block;}
    .lyrh-btn.liked{color:var(--heart);}

    /* Mask fades lyrics out at both ends rather than clipping them. */
    #lyrWrap{flex:1;min-height:0;position:relative;overflow:hidden;
        -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 60px,#000 calc(100% - 76px),transparent 100%);
        mask-image:linear-gradient(to bottom,transparent 0,#000 60px,#000 calc(100% - 76px),transparent 100%);}
    /* overflow-x is pinned because the active line scales past its box and
       overflow-y:auto alone would leave the x axis computing to auto too,
       which gives a horizontal scrollbar on long lines. */
    #lyrScroll{height:100%;overflow-y:auto;overflow-x:hidden;
        padding:38px 26px 96px;scrollbar-width:none;}
    #lyrScroll::-webkit-scrollbar{display:none;}
    #lyrScroll.centered .lyric{text-align:center;transform-origin:center center;}

    /* Volume on the lyrics page
       A vertical strip pinned to the right gutter. It sits inside the padding
       #lyrScroll already leaves, so it costs the words no reading width, and
       it's centred far enough from both mask edges to stay fully opaque. The
       control is an ordinary range input turned a quarter turn — native drag,
       keyboard and focus all still work, and the painted fill runs
       bottom-to-top for free because the gradient rotates with it. */
    #lyrVol{position:absolute;right:0;top:0;bottom:0;width:26px;z-index:3;
        display:flex;align-items:center;justify-content:center;
        pointer-events:none;}
    .lvInner{display:flex;flex-direction:column;align-items:center;gap:7px;
        pointer-events:auto;-webkit-app-region:no-drag;app-region:no-drag;}
    /* Only worth reading while you're actually setting it. */
    .lvPct{font-size:9px;font-weight:500;letter-spacing:.03em;
        color:rgba(255,255,255,.55);font-variant-numeric:tabular-nums;
        opacity:0;transition:opacity .15s;}
    .lvInner:hover .lvPct{opacity:1;}
    /* Fixed slot, because the rotated input's layout box stays horizontal and
       would otherwise stretch the column to its full length. */
    .lvSlot{position:relative;width:22px;height:118px;}
    #lyrVolSlider{position:absolute;left:50%;top:50%;width:118px;margin:0;
        transform:translate(-50%,-50%) rotate(-90deg);}

    /* Inactive lines sit back — smaller, dimmer, softly blurred — so the
       current one is the only thing in focus. The scale jump is what the eye
       actually tracks; the glow is what makes it feel lit rather than just
       white. Both are deliberately larger than they'd be in a bordered card,
       because with no panel around them there's nothing else marking the line. */
    .lyric{
        font-size:var(--lsz,26px);font-weight:800;letter-spacing:-.024em;
        line-height:1.24;color:rgba(255,255,255,.26);
        padding:11px 0;cursor:pointer;user-select:none;
        transform-origin:left center;transform:scale(.93);
        filter:blur(1.6px);
        /* No will-change here on purpose. It used to be on every line, which
           gave a long song a hundred permanently promoted compositor layers
           and cost more memory than it saved frames. The active line is the
           only one that moves far enough to want the hint; it gets it below,
           and the line stepping down keeps its layer for the length of its
           own transition anyway. */
        transition:color .42s cubic-bezier(.4,0,.2,1),
                   filter .42s cubic-bezier(.4,0,.2,1),
                   text-shadow .42s ease,
                   transform .42s cubic-bezier(.34,1.3,.4,1);
    }
    .lyric:hover{color:rgba(255,255,255,.6) !important;filter:blur(0) !important;}
    .lyric.past{color:rgba(255,255,255,.34);filter:blur(.8px);}
    .lyric.active{will-change:transform,filter;
        color:#fff;transform:scale(1.07);filter:blur(0);
        text-shadow:0 0 12px rgba(255,255,255,.28),
                    0 0 44px rgba(255,255,255,.2),
                    0 0 88px var(--accent-glow);
    }

    /* Word timings. Spaces are carried inside the spans, so the line has to
       keep its whitespace or the words run together. */
    .lyric.kara{white-space:pre-wrap;}
    .lyric.kara .w{display:inline;}
    /* The gradient only kicks in on the current line; elsewhere the words just
       take the line's color, and text-shadow still comes from the line. */
    .lyric.kara.active .w{
        background-image:linear-gradient(90deg,#fff 0 var(--p,0%),rgba(255,255,255,.38) var(--p,0%) 100%);
        -webkit-background-clip:text;background-clip:text;
        -webkit-text-fill-color:transparent;color:transparent;
    }
    .lyric.kara.active .w.done{-webkit-text-fill-color:#fff;color:#fff;background-image:none;}
    /* Transparent glyphs let the text-shadow show through from behind, so the
       tight white glow turns into a smear on karaoke lines. Only the wide
       accent halo survives here, which sits far enough out not to bleed in. */
    .lyric.kara.active{text-shadow:0 0 72px var(--accent-glow);}

    @media (prefers-reduced-motion:reduce){
        .lyric{transition:color .3s;transform:none !important}
        .lyric.kara.active .w{-webkit-text-fill-color:#fff;color:#fff;background-image:none;}
    }

    #lyrCtrl{
        flex:0 0 auto;margin:0 12px 12px;padding:12px 18px 14px;position:relative;
        background:rgba(18,18,22,.38);border-radius:24px;
        backdrop-filter:blur(40px) saturate(1.7);
        -webkit-backdrop-filter:blur(40px) saturate(1.7);
        box-shadow:0 18px 44px rgba(0,0,0,.5),0 2px 10px rgba(0,0,0,.28),
                   inset 0 0 0 .5px rgba(255,255,255,.05);
        -webkit-app-region:no-drag;app-region:no-drag;
    }
    #lyrProgWrap{position:relative;height:18px;cursor:pointer;display:flex;align-items:center;margin-bottom:1px;}
    #lyrProgTrack{flex:1;height:5px;background:rgba(255,255,255,.2);border-radius:4px;overflow:hidden;
        transition:height .2s ease,background .2s ease;}
    #lyrProgWrap:hover #lyrProgTrack{height:8px;background:rgba(255,255,255,.26);}
    #lyrProgFill{height:100%;background:rgba(255,255,255,.9);border-radius:4px;}
    .ltimes{display:flex;justify-content:space-between;margin-bottom:4px;}
    .ltm{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--txt-3);
        font-variant-numeric:tabular-nums;}

    /* Same language as the expanded transport, one size down. */
    .lctrlrow{display:flex;align-items:center;justify-content:space-between;}
    .lb{background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
        color:rgba(255,255,255,.92);position:relative;padding:0;border-radius:12px;
        transition:color .14s,background .14s,transform .13s cubic-bezier(.34,1.56,.64,1);}
    .lb:hover{background:var(--glass-hi);}
    .lb:active{transform:scale(.8);}
    .lb svg{fill:currentColor;display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,.35));}
    .lb.lsm{width:38px;height:38px;color:rgba(255,255,255,.6);} .lb.lsm svg{width:16px;height:16px;}
    .lb.lsm:hover{color:#fff;}
    .lb.lmd{width:44px;height:44px;} .lb.lmd svg{width:22px;height:22px;}
    .lb.on{color:var(--accent) !important;}
    .lplay{width:54px !important;height:54px !important;}
    .lplay svg{width:28px !important;height:28px !important;
        filter:drop-shadow(0 3px 9px rgba(0,0,0,.5)) !important;}

    /* Loading / empty states */
    .status{display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:36px 0;gap:12px;opacity:.45;}
    .status .ico svg{width:30px;height:30px;fill:rgba(255,255,255,.7);}
    .status .msg{font-size:13px;font-weight:600;letter-spacing:-.01em;}
    .spinner{width:24px;height:24px;border:2.5px solid rgba(255,255,255,.12);
        border-top-color:rgba(255,255,255,.65);border-radius:50%;animation:spin .65s linear infinite;}
    @keyframes spin{to{transform:rotate(360deg)}}

    /* Settings sheet */
    #settings{position:fixed;inset:0;background:rgba(12,12,16,.55);
        backdrop-filter:blur(44px) saturate(1.6);-webkit-backdrop-filter:blur(44px) saturate(1.6);
        z-index:200;display:none;flex-direction:column;
        -webkit-app-region:no-drag;app-region:no-drag;}
    #settings.open{display:flex;animation:sfade .2s cubic-bezier(.2,.9,.3,1);}
    @keyframes sfade{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
    .sh{display:flex;align-items:center;justify-content:space-between;
        padding:20px 22px 14px;flex-shrink:0;}
    .shtitle{font-size:19px;font-weight:800;letter-spacing:-.02em;}
    /* Matches .lyrh-btn so the header X is the same control everywhere. */
    .sx{background:none;border:none;cursor:pointer;width:32px;height:32px;padding:0;
        border-radius:10px;display:flex;align-items:center;justify-content:center;
        color:var(--txt-3);transition:color .15s,background .15s,transform .13s;}
    .sx:hover{color:#fff;background:var(--glass);}
    .sx:active{transform:scale(.86);}
    .sx svg{fill:currentColor;width:16px;height:16px;display:block;}
    .sbody{flex:1;overflow-y:auto;padding:2px 16px 18px;}
    .scard{background:var(--glass);border-radius:18px;padding:2px 16px;
        box-shadow:inset 0 0 0 .5px var(--hairline),inset 0 .5px 0 rgba(255,255,255,.08);}
    .sr{display:flex;align-items:center;justify-content:space-between;padding:14px 0;}
    .sr + .sr{border-top:1px solid rgba(255,255,255,.07);}
    .slbl{font-size:15px;font-weight:600;letter-spacing:-.01em;color:rgba(255,255,255,.88);}
    .tog{width:48px;height:28px;background:rgba(255,255,255,.16);
        border-radius:15px;position:relative;cursor:pointer;flex-shrink:0;
        transition:background .22s;box-shadow:inset 0 0 0 .5px var(--hairline);}
    .tog.on{background:var(--accent);}
    .tog::after{content:'';position:absolute;top:2.5px;left:2.5px;width:23px;height:23px;
        background:#fff;border-radius:50%;transition:transform .22s cubic-bezier(.34,1.3,.5,1);
        box-shadow:0 1px 6px rgba(0,0,0,.35);}
    .tog.on::after{transform:translateX(20px);}
    .fsrow{display:flex;align-items:center;gap:10px;}
    .fsslider{-webkit-appearance:none;appearance:none;width:112px;height:5px;
        background:rgba(255,255,255,.2);border-radius:4px;outline:none;cursor:pointer;}
    .fsslider::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;
        background:#fff;border-radius:50%;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.4);}
    .fsval{font-size:12px;font-weight:600;color:var(--txt-3);min-width:34px;text-align:right;
        font-variant-numeric:tabular-nums;}
    .stitle{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
        color:var(--txt-3);padding:18px 6px 8px;}
    .shint{font-size:11.5px;color:var(--txt-3);padding:8px 6px 0;line-height:1.45;}

    /* Provider rows. The arrow moves a source up the fallback order; the
       toggle takes it out entirely. */
    .pup{background:var(--glass-hi);border:none;color:rgba(255,255,255,.8);
        width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:12px;
        display:flex;align-items:center;justify-content:center;flex-shrink:0;
        transition:background .15s,transform .13s;box-shadow:inset 0 0 0 .5px var(--hairline);}
    .pup:hover{background:rgba(255,255,255,.22);}
    .pup:active{transform:scale(.85);}
    .pup:disabled{opacity:.25;cursor:default;}
    .prow .slbl{flex:1;}
    .prow .num{font-size:12px;font-weight:700;color:var(--txt-3);width:14px;
        font-variant-numeric:tabular-nums;}
    .prow{gap:10px;}
    .stok{background:rgba(0,0,0,.3);border:none;outline:none;color:#fff;
        border-radius:9px;padding:7px 10px;font-size:12.5px;width:150px;
        font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
        box-shadow:inset 0 0 0 .5px var(--hairline);}
    .stok::placeholder{color:rgba(255,255,255,.3);}

    /* Mode switch */
    .fade{animation:fi .28s cubic-bezier(.2,.9,.3,1);}
    @keyframes fi{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}
    `;

    /* Markup */

    // Expanded and lyrics modes share this row; only the size classes differ.
    const transportRow = (p, base, sm, md, play) => `
            <button class="${base} ${sm}" id="${p}Shuffle" title="Shuffle">${I_SHUFFLE}<span class="rbadge">✦</span></button>
            <button class="${base} ${md}" id="${p}Prev" title="Previous">${I_PREV}</button>
            <button class="${base} ${md} ${play}" id="${p}Play" title="Play/Pause"><svg viewBox="0 0 16 16" id="${p}PlayIco">${I_PLAY}</svg></button>
            <button class="${base} ${md}" id="${p}Next" title="Next">${I_NEXT}</button>
            <button class="${base} ${sm}" id="${p}Repeat" title="Repeat">${I_REPEAT}<span class="rbadge">1</span></button>`;

    // All three modes are built up front and toggled with display, so switching
    // never re-renders. Only one is visible at a time.
    function buildHtml(iv) {
        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><title>WavePlayer</title>
<style>${CSS}</style></head><body>

<div id="bgWrap">
  <div class="bgl" id="bgA"><div class="bgi" id="bgAi"></div></div>
  <div class="bgl" id="bgB"><div class="bgi" id="bgBi"></div></div>
  <div id="bgTint"></div>
</div>
<div id="ov"></div><div id="grain"></div>

<div id="settings">
  <div class="sh"><span class="shtitle">Settings</span>
    <button class="sx" id="sClose" title="Close settings" aria-label="Close settings">${I_CLOSE}</button></div>
  <div class="sbody">
    <div class="scard">
      <div class="sr"><span class="slbl">Center lyrics</span><div class="tog ${centerLyrics?'on':''}" id="togCenter"></div></div>
      <div class="sr"><span class="slbl">Volume slider</span><div class="tog ${showVol?'on':''}" id="togVol"></div></div>
      <div class="sr">
        <span class="slbl">Lyrics size</span>
        <div class="fsrow">
          <input type="range" class="fsslider" id="fsSlider" min="14" max="42" value="${fontSize}">
          <span class="fsval" id="fsVal">${fontSize}px</span>
        </div>
      </div>
    </div>

    <div class="stitle">Lyric sources</div>
    <div class="scard">
      <div class="sr"><span class="slbl">Word-by-word sync</span><div class="tog ${karaoke?'on':''}" id="togKara"></div></div>
      <div id="provList"></div>
      <div class="sr">
        <span class="slbl">Musixmatch token</span>
        <input class="stok" id="mxmTok" type="password" placeholder="optional" value="${mxmToken.replace(/[^\w.-]/g,'')}" spellcheck="false">
      </div>
    </div>
    <div class="shint">Sources are tried top to bottom until one has synced lyrics.
      NetEase and Musixmatch are the ones that carry word timings.</div>
  </div>
</div>

<div id="root">

  <div id="compact" style="display:${mode==='compact'?'flex':'none'}">
    <div id="cGroup">
      <img class="ca paused" id="cArt" src="" alt="Album art">
      <div class="ci">
        <div class="mqwrap ct"><span class="mq" id="cTitle">Loading…</span></div>
        <span class="cr" id="cArtist">—</span>
      </div>
    </div>
    <div class="cbtns chrome" id="cBtns">
      <div class="cpill">
        <button class="cb" id="cPrev" title="Previous">${I_PREV}</button>
        <button class="cb cplay" id="cPlay" title="Play/Pause"><svg viewBox="0 0 16 16" id="cPlayIco">${I_PLAY}</svg></button>
        <button class="cb" id="cNext" title="Next">${I_NEXT}</button>
      </div>
      <button class="cb csec" id="cHeart" title="Like"><svg viewBox="0 0 16 16" id="cHIco">${H_LINE}</svg></button>
      <button class="cb csec" id="cLyrics" title="Lyrics">${I_LYRICS}</button>
      <button class="cb csec" id="cExpand" title="Expand">${I_EXPAND}</button>
      <button class="cb csec" id="cClose" title="Close player">${I_CLOSE}</button>
    </div>
  </div>

  <div id="expanded" style="display:${mode==='expanded'?'flex':'none'}">
    <div class="dh chrome"><div class="dp"></div></div>
    <div id="stage">
      <div id="artSec">
        <div class="af"><img id="artImg" class="paused" src="" alt="Album art" draggable="false"></div>
      </div>
      <div id="infoSec">
        <div class="ir">
          <div class="it">
            <div class="mqwrap etitle"><span class="mq" id="eTitle">Loading…</span></div>
            <div class="eartist" id="eArtist">—</div>
          </div>
          <button class="hb" id="eHeart" title="Like"><svg viewBox="0 0 16 16" id="eHIco">${H_LINE}</svg></button>
        </div>
      </div>
    </div>
    <div id="ctrlCard" class="chrome">
      <div id="progSec">
        <div class="pw" id="ePW">
          <div class="pt"><div class="pf" id="ePF" style="width:0%"></div></div>
        </div>
        <div class="times"><span class="tm" id="eEl">0:00</span><span class="tm" id="eDur">0:00</span></div>
      </div>
      <div id="ctrlSec">
        <div class="ctrlrow">${transportRow('e','eb','sm','md','eplay')}
        </div>
      </div>
      <div id="volSec" style="${showVol?'':'display:none'}">
        <button class="vb" id="volBtn">${vIco(iv)}</button>
        <input type="range" class="vs" id="volSlider" min="0" max="100" value="${iv}">
        <span class="vpct" id="volPct">${iv}%</span>
      </div>
      <div id="expFooter">
        <button class="foot-btn" id="eLyrBtn">Lyrics</button>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="foot-icon" id="eCollapse" title="Compact view">${I_COLLAPSE}</button>
          <button class="foot-icon" id="eGear" title="Settings">${I_GEAR}</button>
          <button class="foot-icon" id="eClose" title="Close player">${I_CLOSE}</button>
        </div>
      </div>
    </div>
  </div>

  <div id="lyrMode" style="display:${mode==='lyrics'?'flex':'none'}">
    <div class="dh chrome"><div class="dp"></div></div>
    <div id="lyrHeader" class="chrome">
      <img id="lyrArtThumb" src="" alt="Album art">
      <div class="it">
        <div class="mqwrap lyrtitle"><span class="mq" id="lyrTitle">Loading…</span></div>
        <div id="lyrArtist">—</div>
      </div>
      <button class="lyrh-btn" id="lyrHeart" title="Like"><svg viewBox="0 0 16 16" id="lHIco">${H_LINE}</svg></button>
      <button class="lyrh-btn" id="lyrBack" title="Back to player">${I_PLAYER}</button>
      <button class="lyrh-btn" id="lyrClose" title="Close player">${I_CLOSE}</button>
      <button class="lyrh-btn" id="lyrGear" title="Settings">${I_GEAR}</button>
    </div>

    <div id="lyrWrap">
      <div id="lyrScroll" class="${centerLyrics?'centered':''}" style="--lsz:${fontSize}px">
        <div class="status"><div class="spinner"></div></div>
      </div>
      <div id="lyrVol" style="${showVol?'':'display:none'}">
        <div class="lvInner chrome">
          <span class="lvPct" id="lyrVolPct">${iv}%</span>
          <div class="lvSlot">
            <input type="range" class="vs" id="lyrVolSlider" min="0" max="100" value="${iv}">
          </div>
          <button class="vb" id="lyrVolBtn" title="Mute">${vIco(iv)}</button>
        </div>
      </div>
    </div>

    <div id="lyrCtrl" class="chrome">
      <div id="lyrProgWrap">
        <div id="lyrProgTrack"><div id="lyrProgFill" style="width:0%"></div></div>
      </div>
      <div class="ltimes"><span class="ltm" id="lEl">0:00</span><span class="ltm" id="lDur">0:00</span></div>
      <div class="lctrlrow">${transportRow('l','lb','lsm','lmd','lplay')}
      </div>
    </div>
  </div>

</div>
</body></html>`;
    }

    /* PiP window */

    async function openPip() {
        // Clicking the launcher again toggles the window closed.
        if (pipWindow && !pipWindow.closed) { pipWindow.close(); pipWindow = null; return; }

        currentTrackUri = null;
        resetPrev();

        const sz = SZ[mode] || SZ.expanded;

        if ('documentPictureInPicture' in window) {
            // There is only one PiP window per client. If Spotify's own
            // miniplayer already holds it, requestWindow rejects and Spotify
            // keeps rendering its miniplayer-is-open controls, so take it first.
            const held = window.documentPictureInPicture.window;
            if (held && !held.closed) {
                try { held.close(); } catch {}
                await new Promise(r => setTimeout(r, 60));
            }
            try {
                pipWindow = await window.documentPictureInPicture.requestWindow({ width: sz.w, height: sz.h });
                setupPip(pipWindow);
                return;
            } catch (e) { console.warn('[WavePlayer]', e); }
        }

        // Fallback for clients without the Document PiP API.
        try {
            const left = window.screen.width - sz.w - 30;
            pipWindow = window.open('about:blank', 'WavePlayer',
                `width=${sz.w},height=${sz.h},left=${left},top=30,resizable=yes`);
            if (pipWindow) setupPip(pipWindow);
            else Spicetify.showNotification('WavePlayer: window blocked', true);
        } catch { Spicetify.showNotification('WavePlayer: error', true); }
    }

    function setupPip(win) {
        const doc = win.document;
        const sp  = Spicetify.Player;
        const iv  = Math.round((sp.getVolume() || 0) * 100);

        doc.write(buildHtml(iv));
        doc.close();

        // Cache every element with an id once. The render loop runs at frame
        // rate, so repeated getElementById calls are worth avoiding.
        const el = {};
        for (const node of doc.querySelectorAll('[id]')) el[node.id] = node;

        const on  = (ids, fn)   => ids.forEach(id => { el[id].onclick = fn; });
        const set = (ids, html) => ids.forEach(id => { el[id].innerHTML = html; });

        let bgFlip = false;

        // Held so the karaoke fill doesn't re-query the DOM every frame.
        let activeLine = null;

        // The rendered lyric lines, in order. Captured once per render so the
        // loop can index straight into them instead of running a querySelectorAll
        // over the whole song every time the active line moves.
        let lyricEls = [];

        // Declared up here rather than beside wake(), because setMode() calls
        // wake() and is itself reachable before that point in the body.
        let idleTimer = null;

        /* Modes */

        function setMode(m) {
            mode = m;
            localStorage.setItem('wp7-mode', mode);
            try { win.resizeTo(SZ[mode].w, SZ[mode].h); } catch {}

            el.compact.style.display  = mode === 'compact'  ? 'flex' : 'none';
            el.expanded.style.display = mode === 'expanded' ? 'flex' : 'none';
            el.lyrMode.style.display  = mode === 'lyrics'   ? 'flex' : 'none';
            el.volSec.style.display   = (showVol && mode === 'expanded') ? 'flex' : 'none';
            el.lyrVol.style.display   = (showVol && mode === 'lyrics')   ? 'flex' : 'none';

            // The loop skips all lyric work outside lyrics mode, so arriving
            // here mid-line finds the index unchanged and does nothing —
            // leaving the page parked at the top with no line lit until the
            // song happens to cross into the next one. Forcing a mismatch
            // makes the next frame highlight and scroll to where we are.
            if (mode === 'lyrics') prev.idx = -1;

            const active = mode === 'compact' ? el.compact : mode === 'expanded' ? el.expanded : el.lyrMode;
            active.classList.add('fade');
            setTimeout(() => active.classList.remove('fade'), 320);

            // Switching into a mode shouldn't land you in a faded-out one.
            wake();
            measureChrome();
            // The two hidden modes measured zero when the track loaded, so
            // their titles never learned whether they overflow. Re-measure the
            // one that just became visible.
            const title = mode === 'compact' ? el.cTitle : mode === 'expanded' ? el.eTitle : el.lyrTitle;
            marquee(title, title.textContent);
        }

        const closePlayer = () => { try { pipWindow?.close(); } catch {} };

        /* Track display */

        let paletteTimer = null, paletteReq = 0, painted = false;

        // Stamped when the cover starts loading rather than when it resolves,
        // so a slow cover can't repaint over a track you've already skipped to.
        function requestPalette(img) {
            const token = ++paletteReq;
            getColors(img).then(p => applyPalette(p, token));
        }

        function applyPalette(p, token) {
            if (token !== paletteReq) return;
            // Cleared before the empty-palette check below, not after. A cover
            // that fails to decode would otherwise return without cancelling
            // the previous track's queued fade-in, and that fade-in then bails
            // on its own stale token — leaving the wash hidden with nothing
            // scheduled to bring it back.
            win.clearTimeout(paletteTimer);

            // No palette means the last track's color stays rather than the
            // wash vanishing. It never comes up on the default accent though,
            // which would tint the window red for no reason.
            if (!p) { if (painted) el.bgTint.classList.add('show'); return; }

            const { dom: d, acc: a } = p;
            const root = doc.documentElement.style;
            doc.body.style.background = `rgb(${Math.round(d.r*.22)},${Math.round(d.g*.22)},${Math.round(d.b*.22)})`;

            // The tint wash is a gradient built out of --accent, and gradients
            // don't transition, so it's faded out, recolored, then faded back
            // in. The UI accent is written in the same breath so the buttons
            // and the wash never disagree about the color.
            const paint = () => {
                if (token !== paletteReq) return;
                root.setProperty('--accent', `rgb(${a.r},${a.g},${a.b})`);
                root.setProperty('--accent-glow', `rgba(${a.r},${a.g},${a.b},.32)`);
                el.bgTint.classList.add('show');
                painted = true;
            };

            if (!el.bgTint.classList.contains('show')) return paint();
            el.bgTint.classList.remove('show');
            paletteTimer = win.setTimeout(paint, 520);
        }

        // Scroll a title only when it actually overflows. Measured next frame,
        // once layout has settled.
        function marquee(span, text) {
            span.textContent = text;
            span.classList.remove('scroll');
            span.style.removeProperty('--mqx');
            win.requestAnimationFrame(() => {
                const wrap = span.parentElement;
                if (!wrap) return;
                const ov = span.scrollWidth - wrap.clientWidth;
                if (ov > 6) {
                    span.style.setProperty('--mqx', `-${ov + 14}px`);
                    span.style.setProperty('--mqd', `${Math.max(5, (ov + 14) / 16)}s`);
                    span.classList.add('scroll');
                }
            });
        }

        function setBackground(img) {
            const next = bgFlip ? el.bgA : el.bgB;
            const cur  = bgFlip ? el.bgB : el.bgA;
            // The image goes on the inner child; the outer layer only carries
            // opacity and the drift animation.
            (bgFlip ? el.bgAi : el.bgBi).style.backgroundImage =
                `url('${img.replace(/'/g,"\\'")}')`;
            next.classList.add('show');
            cur.classList.remove('show');
            bgFlip = !bgFlip;
        }

        /* Liked state */

        // Player.getHeart()/toggleHeart() read and click the now-playing bar's
        // add-to-library button. That button lags the real library state, and
        // isn't rendered at all in some layouts — so the scrape returns
        // undefined and the click lands on nothing. LibraryAPI is the actual
        // source of truth; the old calls stay as a fallback for older clients.
        const lib = () => Spicetify.Platform?.LibraryAPI;

        let heartUri = null, heartState = false;

        // Three things call refreshHeart — the track change, the 4s backstop,
        // and toggleHeart — so several can be in flight at once. Without a
        // stamp a slow answer for the previous track lands after the current
        // one and paints the wrong state, and an optimistic toggle can be
        // reverted by a poll that was already on its way out.
        let heartReq = 0;

        async function refreshHeart(uri) {
            if (!uri) return;
            const token = ++heartReq;
            const api = lib();
            let liked;
            if (api?.contains) {
                try { liked = (await api.contains(uri))?.[0]; } catch {}
            }
            if (token !== heartReq) return;
            // Only meaningful for the track that's actually playing — this
            // reads the now-playing bar, not the uri that was asked about.
            if (liked == null) liked = uri === currentTrackUri ? !!(sp.getHeart?.()) : heartState;
            heartUri = uri;
            heartState = !!liked;
        }

        async function toggleHeart() {
            const uri = currentTrackUri;
            if (!uri) return;
            const api = lib();
            const want = !(heartUri === uri && heartState);

            // Painted before the call so the button answers the click at once;
            // the refresh below corrects it if the write didn't take.
            heartUri = uri;
            heartState = want;

            if (api?.add && api?.remove) {
                try {
                    await (want ? api.add({ uris: [uri] }) : api.remove({ uris: [uri] }));
                } catch { /* fall through to the refresh */ }
            } else {
                sp.toggleHeart?.();
            }
            refreshHeart(uri);
        }

        // Likes made elsewhere — the main window, another device — arrive here.
        // The two shapes are both in the wild depending on client version.
        //
        // This one subscribes to an object in Spotify's window, not this one,
        // so closing the player does not take it with it. The unsubscriber is
        // kept and called on pagehide; without that, every open/close cycle
        // leaves another live closure holding a dead document's `el`, `doc`
        // and `win` alive for the rest of the session.
        let unsubLib = null;
        try {
            const ev = lib()?.getEvents?.();
            const onLibChange = () => refreshHeart(currentTrackUri);
            if (ev?.addListener) {
                ev.addListener(onLibChange);
                unsubLib = () => { try { ev.removeListener(onLibChange); } catch {} };
            } else if (ev?.subscribe) {
                // Some builds hand back a disposer, others expose unsubscribe.
                const h = ev.subscribe(onLibChange);
                unsubLib = () => {
                    try {
                        if (typeof h === 'function') h();
                        else if (typeof h?.unsubscribe === 'function') h.unsubscribe();
                        else ev.unsubscribe?.(onLibChange);
                    } catch {}
                };
            }
        } catch {}

        // Backstop for clients that don't emit those events at all. Cheap
        // enough at this interval, and cleared with the loop on pagehide.
        const heartPoll = win.setInterval(() => refreshHeart(currentTrackUri), 4000);

        // Polls Player.data.item for up to a second waiting for the title to
        // show up, then hands back the fuller object. Bails the moment the uri
        // changes underneath — that's a skip, and loadTrack's token check will
        // throw this result away anyway. Returns the original track if the
        // metadata never fills in, so a slow client just degrades to the old
        // behaviour rather than stalling.
        async function awaitMeta(track) {
            if (titleOf(track)) return track;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => win.setTimeout(r, 50));
                const now = sp.data?.item;
                if (!now || now.uri !== track.uri) return track;
                if (titleOf(now)) return now;
            }
            return sp.data?.item?.uri === track.uri ? sp.data.item : track;
        }

        async function loadTrack(track) {
            if (!track) return;
            const name   = titleOf(track) || 'Unknown';
            const artist = track.artists?.map(a => a.name).join(', ') || artistOf(track) || '—';
            const img    = track.album?.images?.[0]?.url || track.metadata?.image_url || '';

            marquee(el.cTitle, name);
            marquee(el.eTitle, name);
            marquee(el.lyrTitle, name);
            el.cArtist.textContent   = artist;
            el.eArtist.textContent   = artist;
            el.lyrArtist.textContent = artist;

            if (img) {
                el.cArt.src = img;
                el.artImg.src = img;
                el.lyrArtThumb.src = img;
                setBackground(img);
                requestPalette(img);
            }

            refreshHeart(track.uri);

            // Skipping tracks fires this faster than the providers answer, so
            // stamp the request and drop anything that comes back out of turn.
            const token = ++lyricReq;
            // Dropped now rather than on arrival, or the loop spends the fetch
            // highlighting the previous track's lines.
            currentLyrics = null;
            activeLine = null;
            el.lyrScroll.innerHTML = '<div class="status"><div class="spinner"></div></div>';

            // Three of the four providers match on title and artist and bail
            // out early without them. The track change fires the moment the
            // uri lands, which is often a beat before the rest of the metadata
            // does — so dispatching straight away leaves only the uri-based
            // Spotify endpoint able to answer, and a miss there reads as "no
            // lyrics". Wait for a title first.
            const full = await awaitMeta(track);
            if (token !== lyricReq) return;
            if (full !== track) {
                const fname   = titleOf(full) || name;
                const fartist = full.artists?.map(a => a.name).join(', ') || artistOf(full) || artist;
                marquee(el.cTitle, fname);
                marquee(el.eTitle, fname);
                marquee(el.lyrTitle, fname);
                el.cArtist.textContent   = fartist;
                el.eArtist.textContent   = fartist;
                el.lyrArtist.textContent = fartist;

                // Artwork usually lands with the rest of it, so if there was
                // none a moment ago there is probably some now.
                const fimg = full.album?.images?.[0]?.url || full.metadata?.image_url || '';
                if (fimg && fimg !== img) {
                    el.cArt.src = fimg;
                    el.artImg.src = fimg;
                    el.lyrArtThumb.src = fimg;
                    setBackground(fimg);
                    requestPalette(fimg);
                }
            }

            const result = await fetchLyrics(full);
            if (token !== lyricReq) return;

            currentLyrics = result;
            renderLyrics();
            prev.idx = -1;
            prev.word = -1;
        }

        function renderLyrics() {
            activeLine = null;
            lyricEls = [];
            if (!currentLyrics?.lines?.length) {
                el.lyrScroll.innerHTML =
                    `<div class="status"><div class="ico">${I_NO_LYR}</div><div class="msg">No lyrics available</div></div>`;
                return;
            }
            const kara = karaoke && currentLyrics.karaoke;
            el.lyrScroll.innerHTML = currentLyrics.lines.map(l => {
                const words = kara && l.words;
                const body = words
                    ? l.words.map(w => `<span class="w">${esc(w.text)}</span>`).join('')
                    : esc(l.text);
                return `<div class="lyric${words ? ' kara' : ''}" data-t="${l.t}">${body}</div>`;
            }).join('');
            // A live HTMLCollection would re-walk the DOM on every index, so
            // take a flat snapshot — the list only changes when this runs.
            lyricEls = [...el.lyrScroll.children];
        }

        /* Controls */

        const seekFrom = id => e => {
            const r = el[id].getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            if (lastDuration > 0) sp.seek(Math.round(ratio * lastDuration));
        };

        // 0 off, 1 context, 2 track. Clearing prev forces the next frame to repaint.
        const cycleRepeat = () => {
            const cur = sp.getRepeat?.() || 0;
            sp.setRepeat?.((cur + 1) % 3);
            prev.repeat = null;
        };

        /* Shuffle
           0 off, 1 shuffle, 2 smart shuffle. Smart shuffle is only cycled
           through when the client actually exposes it, so older builds keep
           the plain two-state toggle. */

        const playerApi = () => Spicetify.Platform?.PlayerAPI;
        const hasSmart  = () => typeof playerApi()?.setSmartShuffle === 'function';

        // Builds disagree on where the flag lives, so find it by name rather
        // than hard-coding a path that breaks on the next Spotify update. Once
        // found the path is reused; until then it's re-searched occasionally
        // rather than every frame, because the key isn't always present before
        // smart shuffle has been switched on once.
        // Capability flags are named similarly enough to match, and they're
        // always true, so a key has to look like state and not like a feature
        // check before it's trusted.
        const SMART_KEY  = /smart.?shuffle/i;
        const SMART_SKIP = /avail|capab|support|allow|can[_A-Z]|enabled?[_A-Z]/;

        let smartPath = null, smartProbe = 0, smartLast = false;

        function smartOn() {
            const d = sp.data;
            const srcs = [d?.options, d, d?.context?.metadata];
            if (!smartPath && smartProbe++ % 30 === 0) {
                for (let i = 0; i < srcs.length && !smartPath; i++) {
                    for (const k in srcs[i]) {
                        if (SMART_KEY.test(k) && !SMART_SKIP.test(k)) { smartPath = [i, k]; break; }
                    }
                }
            }
            if (smartPath) {
                const v = srcs[smartPath[0]]?.[smartPath[1]];
                // The key going missing means the shape changed under us, so
                // drop the path and let the probe find it again.
                if (v === undefined) smartPath = null;
                else smartLast = v === true || v === 'true';
            }
            return smartLast;
        }

        const shuffleState = () => !sp.getShuffle?.() ? 0 : (smartOn() ? 2 : 1);

        function setShuffleState(s) {
            const api = playerApi();
            if (hasSmart()) {
                try { api.setSmartShuffle(s === 2); } catch {}
                if (s === 2) return;
            }
            // setShuffle is absolute; toggleShuffle is all that older builds have.
            try {
                if (typeof sp.setShuffle === 'function') sp.setShuffle(s === 1);
                else if (!!sp.getShuffle?.() !== (s === 1)) sp.toggleShuffle();
            } catch {}
        }

        const cycleShuffle = () => {
            const max = hasSmart() ? 2 : 1;
            setShuffleState((shuffleState() + 1) % (max + 1));
            prev.shuffle = null;
        };

        /* Idle chrome
           Nothing frames the controls any more, so they're hidden once the
           pointer has been still for a while and brought back on any input.
           Settings being open pins them, otherwise opening it and then not
           moving the mouse would fade the sheet's own controls out. */

        // Both out-of-flow blocks get measured here: the expanded control card,
        // whose height #stage lifts the artwork by, and the compact button
        // strip, whose width #cGroup slides by. Measured rather than hardcoded
        // because the volume row is optional, the footer can wrap, and the
        // button strip's glyph metrics aren't known until it's laid out.
        function measureChrome() {
            if (mode === 'compact') {
                const readW = () => {
                    const w = el.cBtns.offsetWidth;
                    if (w) doc.documentElement.style.setProperty('--cbw', `${w}px`);
                    return w;
                };
                if (!readW()) win.requestAnimationFrame(readW);
                return;
            }
            if (mode !== 'expanded') return;
            // The card floats 12px clear of the bottom edge, so the space it
            // actually takes out of the window is its height plus that gap —
            // measure the gap too rather than hard-coding it here.
            const read = () => {
                const h = el.ctrlCard.offsetHeight;
                if (h) {
                    const gap = win.parseFloat(win.getComputedStyle(el.ctrlCard).bottom) || 0;
                    doc.documentElement.style.setProperty('--ctrlh', `${h + gap}px`);
                }
                return h;
            };
            // Read synchronously so the very first frame already has the real
            // height. Deferring it lets #stage animate from the fallback to the
            // measurement, which reads as a jump right after the window opens.
            // The frame-later retry only covers the case where the card hasn't
            // been laid out yet and measures zero.
            if (!read()) win.requestAnimationFrame(read);
        }

        // mousemove fires on the order of a hundred times a second, and this is
        // bound to it. Tearing down and rebuilding the timer that often is pure
        // waste, so once the chrome is already up the timer is only re-armed
        // every quarter second. The cost is that idle can start up to 250ms
        // earlier than the last pointer move, which nobody can see.
        // -Infinity, not 0: the arming call at startup can land inside the
        // first 250ms of the window's life, and a 0 here would swallow it and
        // leave the chrome up until something moved.
        let lastWake = -Infinity;

        function wake() {
            const up = !doc.body.classList.contains('idle');
            const now = win.performance.now();
            if (up && now - lastWake < 250) return;
            lastWake = now;
            if (!up) doc.body.classList.remove('idle');
            win.clearTimeout(idleTimer);
            idleTimer = win.setTimeout(() => doc.body.classList.add('idle'), 3200);
        }

        const pin = state => { doc.body.classList.toggle('pinned', state); wake(); };

        for (const ev of ['mousemove', 'mousedown', 'wheel', 'keydown', 'touchstart']) {
            doc.addEventListener(ev, wake, { passive: true });
        }

        const openSettings = () => { el.settings.classList.add('open'); pin(true); };

        on(['cPrev',  'ePrev',  'lPrev'],    () => sp.back());
        on(['cPlay',  'ePlay',  'lPlay'],    () => sp.togglePlay());
        on(['cNext',  'eNext',  'lNext'],    () => sp.next());
        on(['cHeart', 'eHeart', 'lyrHeart'], toggleHeart);
        on(['cClose', 'eClose', 'lyrClose'], closePlayer);
        on(['eShuffle', 'lShuffle'], cycleShuffle);
        on(['eRepeat',  'lRepeat'],  cycleRepeat);
        on(['eGear',    'lyrGear'],  openSettings);
        on(['cLyrics',  'eLyrBtn'],  () => setMode('lyrics'));
        on(['cExpand',  'lyrBack'],  () => setMode('expanded'));
        on(['eCollapse'], () => setMode('compact'));

        el.ePW.onclick         = seekFrom('ePW');
        el.lyrProgWrap.onclick = seekFrom('lyrProgWrap');

        // Delegated, so it survives re-rendering the lyric list. Unsynced lines
        // are all t=0, so seeking has to be gated on the attribute existing
        // rather than on it being truthy.
        el.lyrScroll.onclick = e => {
            const line = e.target.closest('.lyric');
            if (currentLyrics?.synced && line?.dataset.t != null) sp.seek(parseInt(line.dataset.t));
        };

        /* Volume */

        // The expanded row and the lyrics strip are two views of one value, so
        // everything below writes to both and neither is treated as the source
        // of truth — the player is.
        const volSliders = [el.volSlider, el.lyrVolSlider];

        const paintVol = v => {
            const bg = `linear-gradient(90deg,rgba(255,255,255,.9) ${v}%,rgba(255,255,255,.16) ${v}%)`;
            for (const s of volSliders) s.style.background = bg;
            el.volPct.textContent    = `${v}%`;
            el.lyrVolPct.textContent = `${v}%`;
        };

        const showVolLevel = v => {
            const ico = vIco(v);
            el.volBtn.innerHTML    = ico;
            el.lyrVolBtn.innerHTML = ico;
            paintVol(v);
        };

        paintVol(iv);

        const onVolInput = e => {
            const v = parseInt(e.target.value);
            sp.setVolume(v / 100);
            // Don't write back into the one being dragged; Chrome drops the
            // in-flight gesture if the value is reassigned mid-drag.
            for (const s of volSliders) if (s !== e.target) s.value = v;
            showVolLevel(v);
        };
        for (const s of volSliders) s.oninput = onVolInput;

        // Mute remembers the previous level so unmuting can restore it.
        let preMuteVol = iv || 50;
        const toggleMute = () => {
            const cur = Math.round((sp.getVolume() || 0) * 100);
            let v;
            if (cur > 0) { preMuteVol = cur; v = 0; }
            else         { v = preMuteVol || 50; }
            sp.setVolume(v / 100);
            for (const s of volSliders) s.value = v;
            showVolLevel(v);
        };
        el.volBtn.onclick    = toggleMute;
        el.lyrVolBtn.onclick = toggleMute;

        /* Settings */

        el.sClose.onclick = () => { el.settings.classList.remove('open'); pin(false); };

        el.togCenter.onclick = () => {
            centerLyrics = !centerLyrics;
            el.togCenter.classList.toggle('on', centerLyrics);
            el.lyrScroll.classList.toggle('centered', centerLyrics);
            localStorage.setItem('wp7-center', centerLyrics);
        };

        el.togVol.onclick = () => {
            showVol = !showVol;
            el.togVol.classList.toggle('on', showVol);
            el.volSec.style.display = (showVol && mode === 'expanded') ? 'flex' : 'none';
            el.lyrVol.style.display = (showVol && mode === 'lyrics')   ? 'flex' : 'none';
            measureChrome();
            localStorage.setItem('wp7-vol', showVol);
        };

        el.fsSlider.oninput = e => {
            fontSize = parseInt(e.target.value);
            el.fsVal.textContent = `${fontSize}px`;
            el.lyrScroll.style.setProperty('--lsz', `${fontSize}px`);
            localStorage.setItem('wp7-fs', fontSize);
        };

        el.togKara.onclick = () => {
            karaoke = !karaoke;
            el.togKara.classList.toggle('on', karaoke);
            localStorage.setItem('wp7-kara', karaoke);
            renderLyrics();
            prev.idx = -1;
        };

        el.mxmTok.onchange = e => {
            mxmToken = e.target.value.trim();
            localStorage.setItem('wp7-mxm', mxmToken);
            lyricCache.clear();
        };

        /* Provider order */

        const PROV_NAMES = {
            spotify: 'Spotify', lrclib: 'LRCLIB',
            netease: 'NetEase', musixmatch: 'Musixmatch',
        };

        function drawProviders() {
            el.provList.innerHTML = provOrder.map((p, i) => `
      <div class="sr prow">
        <span class="num">${i + 1}</span>
        <button class="pup" data-up="${p}" ${i ? '' : 'disabled'} title="Move up">▲</button>
        <span class="slbl">${PROV_NAMES[p]}</span>
        <div class="tog ${provOff.has(p) ? '' : 'on'}" data-prov="${p}"></div>
      </div>`).join('');
        }

        // Re-drawn on every change, so the handler is delegated rather than
        // rebound to elements that are about to be replaced.
        el.provList.onclick = e => {
            const up = e.target.closest('[data-up]')?.dataset.up;
            if (up) {
                const i = provOrder.indexOf(up);
                if (i > 0) [provOrder[i - 1], provOrder[i]] = [provOrder[i], provOrder[i - 1]];
                localStorage.setItem('wp7-prov', provOrder.join(','));
            } else {
                const p = e.target.closest('[data-prov]')?.dataset.prov;
                if (!p) return;
                provOff.has(p) ? provOff.delete(p) : provOff.add(p);
                localStorage.setItem('wp7-prov-off', [...provOff].join(','));
            }
            drawProviders();
            // The cached result came from the old order, so it's stale now.
            lyricCache.clear();
        };

        drawProviders();

        /* Keyboard */

        doc.addEventListener('keydown', e => {
            if (e.target?.tagName === 'INPUT') return;
            switch (e.key) {
                case ' ': e.preventDefault(); sp.togglePlay(); break;
                case 'ArrowRight': if (lastDuration > 0) sp.seek(Math.min(lastDuration, (sp.getProgress?.() || 0) + 5000)); break;
                case 'ArrowLeft':  sp.seek(Math.max(0, (sp.getProgress?.() || 0) - 5000)); break;
                case 'ArrowUp':   e.preventDefault(); sp.setVolume(Math.min(1, (sp.getVolume() || 0) + 0.05)); break;
                case 'ArrowDown': e.preventDefault(); sp.setVolume(Math.max(0, (sp.getVolume() || 0) - 0.05)); break;
                case 'l': case 'L': setMode(mode === 'lyrics' ? 'expanded' : 'lyrics'); break;
                case 'Escape':
                    if (el.settings.classList.contains('open')) { el.settings.classList.remove('open'); pin(false); }
                    else if (mode === 'lyrics') setMode('expanded');
                    break;
            }
        });

        /* Render loop
           Spicetify has no progress event, so state is polled every frame and
           diffed against `prev` to keep DOM writes to a minimum. */

        function tick() {
            rafId = win.requestAnimationFrame(tick);
            const track = sp.data?.item;

            if (track?.uri && track.uri !== currentTrackUri) {
                currentTrackUri = track.uri;
                loadTrack(track);
            }

            const playing = sp.isPlaying();
            if (playing !== prev.playing) {
                prev.playing = playing;
                set(['cPlayIco','ePlayIco','lPlayIco'], playing ? I_PAUSE : I_PLAY);
                // Assigning className is deliberate: it also clears 'paused'.
                el.cArt.className   = `ca${playing ? '' : ' paused'}`;
                el.artImg.className = playing ? 'playing' : 'paused';
                doc.body.classList.toggle('stopped', !playing);
            }

            // Read off the LibraryAPI-backed state rather than re-scraping
            // every frame, and gated on the uri so a stale answer from the
            // previous track can't flash onto this one.
            const heart = heartUri === currentTrackUri && heartState;
            if (heart !== prev.heart) {
                prev.heart = heart;
                set(['cHIco','eHIco','lHIco'], heart ? H_FILL : H_LINE);
                // Toggled rather than reassigned. prev.heart starts null, so
                // the first tick always fires, and a full className write used
                // to strip the base classes off all three buttons right there.
                el.cHeart.classList.toggle('hon', heart);
                el.eHeart.classList.toggle('liked', heart);
                el.lyrHeart.classList.toggle('liked', heart);
            }

            const shuffle = shuffleState();
            if (shuffle !== prev.shuffle) {
                prev.shuffle = shuffle;
                for (const b of [el.eShuffle, el.lShuffle]) {
                    b.classList.toggle('on', shuffle > 0);
                    b.classList.toggle('smart', shuffle === 2);
                    b.title = ['Shuffle', 'Shuffle on', 'Smart shuffle'][shuffle];
                }
            }

            const repeat = sp.getRepeat?.() ?? 0;
            if (repeat !== prev.repeat) {
                prev.repeat = repeat;
                el.eRepeat.classList.toggle('on', repeat > 0);
                el.lRepeat.classList.toggle('on', repeat > 0);
                el.eRepeat.classList.toggle('r1', repeat === 2);
                el.lRepeat.classList.toggle('r1', repeat === 2);
            }

            const pos = sp.getProgress?.() ?? 0;
            const dur = Number(track?.duration?.milliseconds || track?.duration_ms || track?.metadata?.duration || 0);
            lastDuration = dur;
            const pct = dur > 0 ? Math.min(100, (pos/dur)*100) : 0;

            // Sub-pixel moves aren't visible, so skip them.
            if (Math.abs(pct - prev.pct) > 0.06) {
                prev.pct = pct;
                const ps = pct.toFixed(2) + '%';
                el.ePF.style.width = ps;
                el.lyrProgFill.style.width = ps;
            }

            if (dur !== prev.dur) {
                prev.dur = dur;
                el.eEl.textContent  = fmt(pos);
                el.eDur.textContent = fmt(dur);
                el.lEl.textContent  = fmt(pos);
                el.lDur.textContent = fmt(dur);
            } else {
                // Elapsed text only needs a few updates a second.
                const rnd = Math.round(pos/250)*250;
                if (Math.abs(rnd - prev.el) >= 250) {
                    prev.el = rnd;
                    const fs = fmt(pos);
                    el.eEl.textContent = fs;
                    el.lEl.textContent = fs;
                }
            }

            // Don't fight the user while they're dragging either slider.
            if (!volSliders.includes(doc.activeElement)) {
                const v = Math.round((sp.getVolume() || 0) * 100);
                if (v !== prev.vol) {
                    prev.vol = v;
                    for (const s of volSliders) s.value = v;
                    showVolLevel(v);
                }
            }

            if (currentLyrics?.synced && mode === 'lyrics') {
                const lines = currentLyrics.lines;
                let ai = -1;
                for (let i = lines.length - 1; i >= 0; i--) { if (pos >= lines[i].t) { ai = i; break; } }

                if (ai !== prev.idx) {
                    const was = prev.idx;
                    prev.idx = ai;
                    prev.word = -1;
                    activeLine = null;
                    // Only the lines whose state actually changed get touched:
                    // the one that was active, the one that is now, and the
                    // `past` run between them. Rewriting every line in the song
                    // on each advance is the same result at ten times the cost,
                    // and on a long track it's enough to show up as a hitch.
                    // A fresh render (was < 0) starts from the top, because a
                    // seek into the middle still has to mark everything behind
                    // the new line as past.
                    const lo = Math.max(0, Math.min(was < 0 ? 0 : was, ai));
                    const hi = Math.min(lyricEls.length - 1, Math.max(was, ai));
                    for (let i = lo; i <= hi; i++) {
                        const line = lyricEls[i];
                        if (!line) continue;
                        if (i === ai) {
                            line.classList.remove('past');
                            line.classList.add('active');
                            activeLine = line;
                            // Only auto-scroll while playing, so manual scrolling isn't yanked back.
                            if (playing) {
                                // A smooth scroll runs at a fixed speed, so a
                                // long one crawls — switching into lyrics
                                // halfway through a song, or seeking across the
                                // track, would spend a second visibly sliding.
                                // Anything past a screen and a half snaps.
                                const wr = el.lyrWrap.getBoundingClientRect();
                                const lr = line.getBoundingClientRect();
                                const off = Math.abs((lr.top + lr.height / 2) - (wr.top + wr.height / 2));
                                line.scrollIntoView({
                                    behavior: off > wr.height * 1.5 ? 'auto' : 'smooth',
                                    block: 'center',
                                });
                            }
                        } else {
                            line.classList.remove('active');
                            line.classList.toggle('past', i < ai);
                        }
                    }
                }

                // Karaoke fill. Only the current line is touched each frame, and
                // only the word being sung actually changes — the ones already
                // sung get a flat fill and are left alone until the line moves.
                const words = activeLine?.classList.contains('kara') ? lines[ai]?.words : null;
                if (words?.length) {
                    const spans = activeLine.children;
                    let wi = -1;
                    for (let i = words.length - 1; i >= 0; i--) { if (pos >= words[i].t) { wi = i; break; } }

                    if (wi !== prev.word) {
                        for (let i = 0; i < spans.length; i++) {
                            spans[i].classList.toggle('done', i < wi);
                            if (i > wi) spans[i].style.setProperty('--p', '0%');
                        }
                        prev.word = wi;
                    }
                    if (wi >= 0) {
                        const w = words[wi];
                        const p = Math.max(0, Math.min(1, (pos - w.t) / (w.d || 1)));
                        spans[wi]?.style.setProperty('--p', (p * 100).toFixed(1) + '%');
                    }
                }
            }
        }

        // Stop the loop when the window goes away, or it keeps running detached.
        // Guarded on identity: this fires late enough that a reopened player
        // can already be the current one, and an unguarded version would null
        // out the new window's handle and cancel its frame instead of this
        // one's. rafId is only ever the live window's, so it's only cleared
        // when this window is still the live one.
        win.addEventListener('pagehide', () => {
            win.clearInterval(heartPoll);
            unsubLib?.();
            if (pipWindow !== win) return;
            pipWindow = null;
            if (rafId !== null) { win.cancelAnimationFrame(rafId); rafId = null; }
        });

        // Arms the idle timer; without this the chrome stays up until the
        // first pointer move, which never comes if you don't touch the window.
        wake();
        measureChrome();
        // Resizing can rewrap the footer, which changes the card's height.
        // Coalesced to one measurement per frame: a drag-resize fires this
        // continuously, and measureChrome reads offsetHeight and computed
        // style, so running it per event forces a layout per event.
        let resizePending = false;
        win.addEventListener('resize', () => {
            if (resizePending) return;
            resizePending = true;
            win.requestAnimationFrame(() => { resizePending = false; measureChrome(); });
        });

        const track = sp.data?.item;
        if (track) { currentTrackUri = track.uri; loadTrack(track); }
        tick();
    }

    /* Update notice
       Lives in Spotify's own document, not the PiP window, so it can appear
       before the player has ever been opened. Styling is deliberately
       self-contained — Spotify renames its CSS variables between releases, so
       inheriting from them would break silently. */

    // Wave's own mark, inline: a five-bar waveform in the tile at the top of
    // the card. No asset to ship and nothing to 404 if a release is repacked.
    const I_WAVE = '<svg viewBox="0 0 24 24">' +
        '<rect x="2.5"  y="9"   width="3" height="6"  rx="1.5" opacity=".55"/>' +
        '<rect x="6.5"  y="5.5" width="3" height="13" rx="1.5" opacity=".8"/>' +
        '<rect x="10.5" y="2.5" width="3" height="19" rx="1.5"/>' +
        '<rect x="14.5" y="6.5" width="3" height="11" rx="1.5" opacity=".8"/>' +
        '<rect x="18.5" y="8.5" width="3" height="7"  rx="1.5" opacity=".55"/></svg>';

    const I_CHEV = '<svg class="wpnChev" viewBox="0 0 24 24">' +
        '<path d="M9.3 5.3 16 12l-6.7 6.7-1.4-1.4L13.2 12 7.9 6.7z"/></svg>';

    // No accent colour. The card is grey on grey and the only bright thing in
    // it is the text, which is also the only part worth reading. --wpnHair is
    // the one rule weight used for every divider so they all match.
    const WPN_CSS = `
#wpnOverlay{--wpnHair:rgba(255,255,255,.08);
    position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;
    justify-content:center;background:rgba(0,0,0,.64);
    backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
    opacity:0;transition:opacity .22s ease;
    font-family:'CircularSp','Circular Std',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
#wpnOverlay.in{opacity:1;}
#wpnCard{position:relative;width:min(430px,calc(100vw - 48px));max-height:calc(100vh - 88px);
    overflow-y:auto;box-sizing:border-box;border-radius:16px;background:#141414;
    padding:24px 24px 18px;color:#fff;text-align:left;
    box-shadow:0 26px 90px rgba(0,0,0,.62),0 0 0 .5px rgba(255,255,255,.12);
    transform:scale(.97) translateY(8px);transition:transform .24s cubic-bezier(.2,.9,.3,1);}
#wpnOverlay.in #wpnCard{transform:none;}
#wpnCard::-webkit-scrollbar{width:0;}
.wpnTop{display:flex;align-items:center;gap:11px;padding-right:30px;}
.wpnMark{width:30px;height:30px;border-radius:9px;flex:none;display:flex;align-items:center;
    justify-content:center;color:rgba(255,255,255,.9);background:rgba(255,255,255,.07);}
.wpnMark svg{width:18px;height:18px;fill:currentColor;}
/* Version lives in the title and nowhere else above the fold. Mono, because a
   version number is a value, not a word. */
.wpnTitle{font-size:16px;font-weight:600;letter-spacing:-.01em;margin:0;}
.wpnVer{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;
    font-weight:500;color:rgba(255,255,255,.4);letter-spacing:-.02em;margin-left:7px;}
.wpnSub{font-size:12px;color:rgba(255,255,255,.45);margin:2px 0 0;}
.wpnX{position:absolute;top:16px;right:16px;width:26px;height:26px;border:0;padding:0;
    border-radius:50%;background:transparent;color:rgba(255,255,255,.4);cursor:pointer;
    display:flex;align-items:center;justify-content:center;transition:color .15s,background .15s;}
.wpnX:hover{color:#fff;background:rgba(255,255,255,.08);}
.wpnX svg{width:15px;height:15px;fill:currentColor;}
.wpnBody{margin:18px 0 0;}
.wpnLead{font-size:13px;line-height:1.62;color:rgba(255,255,255,.72);margin:0;}
/* A note above the list gets a rule under it, so the personal bit and the
   mechanical bit don't run together. */
.wpnLead + .wpnRel{margin-top:14px;padding-top:14px;border-top:.5px solid var(--wpnHair);}
/* One version heading per release block, shown only when more than one
   release is on screen — otherwise the title already said it. */
.wpnRelHead{display:flex;align-items:baseline;gap:8px;margin:0 0 2px;}
.wpnRelV{font-size:11px;font-weight:600;color:rgba(255,255,255,.5);letter-spacing:.03em;}
.wpnDate{font-size:11px;color:rgba(255,255,255,.3);margin-left:auto;}
/* Spec sheet: a fixed label column, a hairline between every row, nothing
   else. The labels line up, so the eye can skim the left edge for the part
   it cares about instead of reading three full sentences. */
.wpnList{list-style:none;margin:0;padding:0;}
.wpnList li{display:grid;grid-template-columns:76px 1fr;gap:14px;align-items:baseline;
    padding:11px 0;border-top:.5px solid var(--wpnHair);}
.wpnList li:first-child{border-top:0;padding-top:2px;}
.wpnK{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(255,255,255,.36);}
.wpnV{font-size:13.5px;line-height:1.5;color:rgba(255,255,255,.82);}
/* A note with no label spans both columns rather than sitting in a stub. */
.wpnList li.wide{grid-template-columns:1fr;}
.wpnRel + .wpnRel{margin-top:14px;padding-top:14px;border-top:.5px solid var(--wpnHair);}
.wpnFoot{display:flex;align-items:center;gap:12px;margin:18px 0 0;padding-top:14px;
    border-top:.5px solid var(--wpnHair);}
.wpnHint{font-size:11.5px;color:rgba(255,255,255,.3);
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
/* Quiet and full width. It's an acknowledgement, not a call to action — the
   width is there to make it an easy target, not to make it loud. */
.wpnOk{width:100%;cursor:pointer;padding:10px 18px;border-radius:10px;
    background:rgba(255,255,255,.07);border:.5px solid rgba(255,255,255,.1);
    color:rgba(255,255,255,.85);font-size:13px;font-weight:600;font-family:inherit;
    transition:transform .12s,background .15s,color .15s,border-color .15s;}
.wpnOk:hover{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.2);color:#fff;}
.wpnOk:active{transform:scale(.99);}
/* With a hint alongside, the button stops being full width and yields the
   left half of the row to it. */
.wpnFoot .wpnHint + .wpnOk{width:auto;margin-left:auto;}

/* Changelogs disclosure. Native <details> so it works with no JS and keeps
   keyboard and screen-reader behaviour for free. */
.wpnDrop{margin:18px 0 0;padding-top:4px;border-top:.5px solid rgba(255,255,255,.1);}
.wpnDrop summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:9px;
    padding:9px 2px;font-size:12.5px;font-weight:600;color:rgba(255,255,255,.62);
    transition:color .15s;}
.wpnDrop summary::-webkit-details-marker{display:none;}
.wpnDrop summary::marker{content:'';}
.wpnDrop summary:hover{color:#fff;}
.wpnDrop[open] summary{color:#fff;}
.wpnChev{width:12px;height:12px;flex:none;fill:currentColor;opacity:.8;
    transition:transform .2s cubic-bezier(.2,.9,.3,1);}
.wpnDrop[open] .wpnChev{transform:rotate(90deg);}
.wpnCount{margin-left:auto;font-size:11px;font-weight:500;color:rgba(255,255,255,.32);}
.wpnDropBody{padding:2px 0 2px;}
.wpnDropBody .wpnRel:first-child{margin-top:0;padding-top:0;border-top:0;}
@media (prefers-reduced-motion:reduce){
    #wpnOverlay,#wpnCard,.wpnChev{transition:none;}
}`;

    // `fresh` swaps the change list for a short hello — a first-time user has
    // no "before" to compare against, so a changelog would be noise.
    function showWhatsNew(entries, fresh, from) {
        if (document.getElementById('wpnOverlay')) return;

        if (!document.getElementById('wpnStyle')) {
            const st = document.createElement('style');
            st.id = 'wpnStyle';
            st.textContent = WPN_CSS;
            document.head.appendChild(st);
        }

        // Date of the newest thing being announced, for the line under the title.
        const date = (entries[0] || CHANGELOG[0])?.date || '';
        const sub  = fresh ? 'Installed'
                   : (from ? `Updated from ${from} · ${date}` : `Updated · ${date}`);

        const noteRow = n => (n && typeof n === 'object')
            ? `<li><span class="wpnK">${n.k}</span><span class="wpnV">${n.v}</span></li>`
            : `<li class="wide"><span class="wpnV">${n}</span></li>`;

        // The version heading is dead weight when the card's own title already
        // names the release, so it only runs where a block could be confused
        // for another one: inside the dropdown, or when several are stacked.
        const relBlock = (e, head) => `
                <div class="wpnRel">
                  ${head ? `<div class="wpnRelHead"><span class="wpnRelV">${e.v}</span>
                    <span class="wpnDate">${e.date}</span></div>` : ''}
                  <ul class="wpnList">${e.notes.map(noteRow).join('')}</ul>
                </div>`;

        // Whatever isn't already spelled out above the fold. Collapsed by
        // default, and skipped entirely when there's nothing left to put in it.
        const drop = rest => rest.length ? `
            <details class="wpnDrop">
              <summary>${I_CHEV}<span>Changelogs</span>
                <span class="wpnCount">${rest.length} release${rest.length === 1 ? '' : 's'}</span>
              </summary>
              <div class="wpnDropBody">${rest.map(e => relBlock(e, true)).join('')}</div>
            </details>` : '';

        const body = fresh
            // The shortcut is already in the footer hint, so it doesn't run here too.
            ? `<p class="wpnLead">Open it from the miniplayer button in the player bar or the
                 Wave icon in the top bar. Settings live behind the gear in the player's own
                 header.</p>` + drop(CHANGELOG)
            // Only the newest entry's note runs, even when several releases are
            // shown at once — one greeting, not one per version. Releases older
            // than the ones being announced fall into the dropdown.
            : (entries[0]?.lead ? `<p class="wpnLead">${entries[0].lead}</p>` : '')
              + entries.map(e => relBlock(e, entries.length > 1)).join('')
              + drop(CHANGELOG.slice(entries.length));

        const ov = document.createElement('div');
        ov.id = 'wpnOverlay';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-label', fresh ? 'Wave Player installed' : 'What’s new in Wave Player');
        ov.innerHTML = `
          <div id="wpnCard">
            <button class="wpnX" id="wpnX" aria-label="Close">${I_CLOSE}</button>
            <div class="wpnTop">
              <span class="wpnMark">${I_WAVE}</span>
              <div>
                <p class="wpnTitle">Wave Player<span class="wpnVer">${VERSION}</span></p>
                <p class="wpnSub">${sub}</p>
              </div>
            </div>
            <div class="wpnBody">${body}</div>
            <div class="wpnFoot">
              ${fresh ? '<span class="wpnHint">Ctrl + Shift + M</span>' : ''}
              <button class="wpnOk" id="wpnOk">${fresh ? 'Let’s go' : 'Got it'}</button>
            </div>
          </div>`;

        // Escape has to come off the document, since Spotify steals focus back
        // to its own shell often enough that a listener on the card misses it.
        const close = () => {
            ov.classList.remove('in');
            document.removeEventListener('keydown', onKey, true);
            setTimeout(() => ov.remove(), 240);
        };
        const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        document.addEventListener('keydown', onKey, true);

        document.body.appendChild(ov);
        ov.querySelector('#wpnX').onclick = close;
        ov.querySelector('#wpnOk').onclick = close;
        // Two frames: one for the node to land, one for the transition to have
        // a starting value to animate from.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            ov.classList.add('in');
            ov.querySelector('#wpnOk').focus();
        }));
    }

    // Re-openable by hand from the console, and a convenient way to preview a
    // changelog entry before shipping it.
    window.wavePlayerWhatsNew = () => showWhatsNew(CHANGELOG.slice(0, 1), false, null);

    function checkVersion() {
        let seen;
        try { seen = localStorage.getItem('wp7-seen-ver'); } catch { return; }
        if (seen === VERSION) return;

        // Write first. If anything below throws, the worst case is that one
        // release's notes go unseen — far better than the notice reappearing
        // on every single launch.
        try { localStorage.setItem('wp7-seen-ver', VERSION); } catch {}

        const fresh = seen === null;
        // Entries above the last one they saw. An unrecognised version — a
        // downgrade, or a build whose entry was never written — falls back to
        // showing just the newest.
        const i = CHANGELOG.findIndex(e => e.v === seen);
        const entries = i === -1 ? CHANGELOG.slice(0, 1) : CHANGELOG.slice(0, i);
        if (!fresh && !entries.length) return;

        // Spotify's own shell is still mounting at this point and will happily
        // re-render over the top of us, so let it settle first.
        setTimeout(() => showWhatsNew(entries, fresh, seen), 1400);
    }

    /* Launcher
       Take over Spotify's own miniplayer button. Spotify renames the testid
       between versions and localizes the label, so match on several things.
       These listeners live for the whole session, since the button is
       re-created as the UI re-renders. */

    const MINI_SEL = [
        '[data-testid="pip-toggle-button"]',
        '[data-testid*="miniplayer" i]',
        '[data-testid*="pip-toggle" i]',
        '[aria-label*="miniplayer" i]',
        '[aria-label*="mini player" i]',
        '[aria-label*="picture in picture" i]',
        '[aria-label*="picture-in-picture" i]',
    ].join(',');

    // Only stops other handlers; no preventDefault here, or the click that
    // follows never fires. Newer Spotify builds act on pointerdown, so blocking
    // click alone is too late and the native miniplayer opens anyway.
    const blockOthers = e => {
        if (!e.target.closest?.(MINI_SEL)) return false;
        e.stopPropagation();
        e.stopImmediatePropagation();
        return true;
    };

    document.addEventListener('pointerdown', blockOthers, true);
    document.addEventListener('mousedown', blockOthers, true);
    document.addEventListener('click', e => {
        if (!blockOthers(e)) return;
        e.preventDefault();
        openPip();
    }, true);

    // Ways in that don't depend on Spotify's DOM. If the selectors above ever
    // stop matching, the extension is still reachable instead of looking dead.
    try { new Spicetify.Topbar.Button('Wave Player', I_PLAYER, openPip, false); } catch {}
    try { Spicetify.Keyboard?.registerShortcut?.({ key: 'm', ctrl: true, shift: true }, openPip); } catch {}

    // Last thing to run, and wrapped, so a problem in the notice can never stop
    // the player itself from having already been set up above.
    try { checkVersion(); } catch {}
})();
