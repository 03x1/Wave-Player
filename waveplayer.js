// Wave Player: an Apple Music–style mini player for Spotify (Spicetify extension).

(async function WavePlayer() {
    // Guard against being loaded twice (e.g. registered twice in Spicetify).
    if (window.__wavePlayerLoaded) return;
    window.__wavePlayerLoaded = true;

    // Spicetify loads extensions before its APIs are ready.
    while (!Spicetify?.Player?.data || !Spicetify?.Platform || !Spicetify?.CosmosAsync) {
        await new Promise(r => setTimeout(r, 100));
    }

    /* Config */

    // Window content size per view. "panel" = lyrics, Up Next and Settings.
    const SZ = {
        compact:  { w: 440, h: 192 },
        expanded: { w: 440, h: 436 },
        panel:    { w: 440, h: 620 },
    };
    const SZ_DEFAULT = JSON.parse(JSON.stringify(SZ));
    const SZ_MIN = { compact: { w: 380, h: 180 }, expanded: { w: 320, h: 320 }, panel: { w: 360, h: 460 } };
    // Sizes the user resized a view to are remembered.
    try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem('wp7-size') || '{}'))) if (SZ[k] && v?.w && v?.h) SZ[k] = v; } catch {}

    // To release: bump VERSION and add an entry at the top of CHANGELOG.
    // summary = short list on the update screen; notes = full changelog.
    const VERSION = 'v3';

    const CHANGELOG = [
        {
            v: 'v3',
            date: 'October 2026',
            summary: [
                { i: 'design', c: ['#ff3b5c', '#ff8a3d'], t: 'All-new design', d: 'Modelled on Apple Music’s mini player, with a compact and an expanded view.' },
                { i: 'swirl',  c: ['#1fb5c9', '#3d7bff'], t: 'Living background', d: 'Your cover’s colours swirl behind the player.' },
                { i: 'canvas', c: ['#7b5cff', '#d14cff'], t: 'Animated covers', d: 'Songs with a Canvas play it in the expanded view, like on your phone.' },
                { i: 'full',   c: ['#ff5ea8', '#8a5cff'], t: 'Full screen', d: 'Spotify’s full screen button opens a big view with the cover and lyrics.' },
                { i: 'list',   c: ['#1fa483', '#7ed957'], t: 'Up Next and a new menu', d: 'Jump to any song in the queue. Like, add to playlist, sleep timer and more.' },
                { i: 'bolt',   c: ['#ffb020', '#ff5e3a'], t: 'Faster and smoother', d: 'Much lighter on your PC, and the volume slider no longer stutters.' },
            ],
            notes: [
                { k: 'Design', v: [
                    'A complete redesign, modelled on Apple Music’s mini player.',
                    'Compact view: artwork, title, progress and controls in one strip.',
                    'Expanded view: the artwork fills the window. The expand button switches between the two.',
                    'Long titles scroll so you can read them.',
                ] },
                { k: 'Background', v: [
                    'A living background made from the cover’s colours, slowly swirling.',
                    'Choose how fast it moves in Settings, from still to 3×.',
                ] },
                { k: 'Animated covers', v: [
                    'Songs with a Spotify Canvas play it in the expanded view, looping.',
                    'Songs without one keep their cover. Switch it off in Settings.',
                ] },
                { k: 'Full screen', v: [
                    'Spotify’s full screen button now opens Wave Player full screen: the cover and controls on the left, lyrics on the right.',
                    'Shuffle, repeat and a volume slider under the controls. Lyrics and Settings sit in the corner.',
                    'Lyrics only: hide the cover and controls and just show the lyrics (in Settings).',
                    'The mini player steps aside while it’s open, and comes back when you close it with ✕.',
                ] },
                { k: 'Lyrics', v: [
                    'Lyrics open right inside the player, in sync, word by word where available.',
                    'Four sources: Spotify, LRCLIB, NetEase and Musixmatch. Reorder or switch them off in Settings.',
                    'Lyrics out of time? Nudge them earlier or later with − and + (or the [ and ] keys). Remembered per song. Full screen has it in Settings.',
                ] },
                { k: 'Up Next', v: [
                    'See what’s queued and what plays next, and click any song to jump to it.',
                    'Shuffle (including smart shuffle) and repeat live at the top.',
                ] },
                { k: 'Menu', v: [
                    'Save to Liked Songs, add to a playlist, go to the album or artist, copy the song link, and Settings.',
                    'Sleep timer: stop playback after 5 minutes to an hour, or at the end of the song.',
                ] },
                { k: 'Controls', v: [
                    'Volume opens a small slider that closes once you let go, or scroll anywhere on the player. Hold previous or next to scrub through the song.',
                    'Auto-hide controls, switched on separately for compact, expanded and lyrics. Off by default.',
                    'Drag the window from anywhere that isn’t a button.',
                ] },
                { k: 'Window', v: [
                    'Opens where you last left it.',
                    'Each view remembers the size you resize it to. Reset them in Settings.',
                ] },
                { k: 'Podcasts', v: 'Episodes show their show name, and the menu offers Your Episodes, Go to Show and the episode link.' },
                { k: 'Performance', v: [
                    'The player only updates when something changes.',
                    'The volume slider is smooth, and GPU use is a fraction of what it was.',
                ] },
                { k: 'Fixes', v: [
                    'The top-bar button works again on Spotify 1.3.',
                    'If the player can’t open, it now says why instead of “window blocked”.',
                    'The Spotify lyrics source works again on newer clients.',
                    'Windows land at the right size when switching views, and Chrome can no longer resize the player by itself.',
                ] },
            ],
        },
        {
            v: 'v2.1',
            date: 'September 2026',
            notes: [
                { k: 'Lyrics', v: 'Fixed the Spotify source giving up after a single rejected request.' },
            ],
        },
        {
            v: 'v2',
            date: 'September 2026',
            notes: [
                { k: 'Volume', v: ['Vertical slider on the right edge of the lyrics page.', 'Both sliders stay in step with Spotify.', 'Mute restores the level you were at.'] },
            ],
        },
    ];

    // Settings keep their old wp7-* keys so existing installs keep them.
    let mode         = localStorage.getItem('wp7-mode') === 'expanded' ? 'expanded' : 'compact';
    let centerLyrics = localStorage.getItem('wp7-center') !== 'false';
    let fontSize     = parseInt(localStorage.getItem('wp7-fs') || '24');
    let canvasOn     = localStorage.getItem('wp7-canvas') !== 'false';
    let lyricsOnly   = localStorage.getItem('wp7-lyrics-only') === 'true';
    // Background speed multiplier (0 = still).
    let swirlSpeed   = Math.min(3, Math.max(0, parseFloat(localStorage.getItem('wp7-swirl') ?? '1') || 0));
    // Auto-hide per view, off by default.
    const autoHide = {
        compact:  localStorage.getItem('wp7-ah-compact') === 'true',
        expanded: (localStorage.getItem('wp7-ah-expanded') ?? localStorage.getItem('wp7-autohide')) === 'true',
        lyrics:   localStorage.getItem('wp7-ah-lyrics') === 'true',
    };

    // Lyric sources in default order.
    const PROVIDERS = ['spotify', 'lrclib', 'netease', 'musixmatch'];

    // Saved order, with unknown names dropped and new sources appended.
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

    /* Album art colours */

    const clampC = n => Math.max(0, Math.min(255, Math.round(n)));

    // Dominant colour + an accent from a small k-means over the cover.
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

        // Accent: the most saturated colour that differs from the dominant one.
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

        // Lift dark accents so they stay visible.
        const FLOOR = 0.42;
        const aLum = (0.2126*acc.r + 0.7152*acc.g + 0.0722*acc.b)/255;
        if (aLum < FLOOR) acc = shade(acc, (FLOOR - aLum) / (1 - aLum));

        return { dom, acc };
    }

    // k > 0 lightens, k < 0 darkens.
    const shade = (q, k) => k > 0
        ? { r: clampC(q.r + (255-q.r)*k), g: clampC(q.g + (255-q.g)*k), b: clampC(q.b + (255-q.b)*k) }
        : { r: clampC(q.r*(1+k)), g: clampC(q.g*(1+k)), b: clampC(q.b*(1+k)) };

    const colorCache = new Map();

    function getColors(url) {
        if (!url) return Promise.resolve(null);
        if (colorCache.has(url)) return Promise.resolve(colorCache.get(url));
        return new Promise(res => {
            const img = new Image();
            // Needed to read the pixels back.
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

    // Every source is normalised to: start, duration, text, optional word timings.
    const mkLine = (t, text, words, d) => ({ t: Math.round(t), d: d ?? null, text, words: words || null });

    /* Network
       fetch first; CosmosAsync as a fallback (some clients break one or the other). */

    // Spotify hosts need the client's token; other APIs need no headers.
    function spotifyAuth() {
        const p = Spicetify.Platform;
        const raw = p?.AuthorizationAPI?.getState?.()?.token
                 || p?.Session?.accessToken
                 || p?.AuthorizationAPI?._state?.token;
        // Newer clients return { accessToken } instead of a string.
        const tok = raw?.accessToken ?? raw;
        return typeof tok === 'string' ? { Authorization: `Bearer ${tok}`, 'App-Platform': 'WebPlayer' } : null;
    }

    // Statuses worth retrying through Cosmos (it carries its own credentials). A 404 is final.
    const retryOnCosmos = s => s === 401 || s === 403 || s === 407 ||
                               s === 408 || s === 429 || s >= 500;

    async function viaFetch(url) {
        const spotify = /(^|\.)spotify\.com$/.test(new URL(url).hostname);
        const headers = spotify ? spotifyAuth() : null;
        if (spotify && !headers) throw new Error('no access token');

        const res = await fetch(url, headers ? { headers } : undefined);
        if (!res.ok) {
            const e = new Error('HTTP ' + res.status);
            e.answered = !retryOnCosmos(res.status);
            throw e;
        }
        return res.json();
    }

    const cos = async url => {
        if (url.startsWith('wg://')) return Spicetify.CosmosAsync.get(url);
        try {
            return await viaFetch(url);
        } catch (e) {
            if (e?.answered) throw e;
            return Spicetify.CosmosAsync.get(url);
        }
    };

    // The track object differs between client versions; read fields through these.
    const msOf     = t => Number(t?.duration?.milliseconds || t?.duration_ms || t?.metadata?.duration || 0);
    const secs     = t => Math.round(msOf(t) / 1000);
    const titleOf  = t => t?.name || t?.metadata?.title || '';
    const artistOf = t => t?.artists?.[0]?.name || t?.metadata?.artist_name || '';
    const albumOf  = t => t?.album?.name || t?.metadata?.album_title || '';

    /* Parsers */

    const LINE_TAG = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
    const WORD_TAG = /<(\d+):(\d+)(?:[.:](\d+))?>/g;

    // Pad .x / .xx fractions to milliseconds.
    const tagMs = (m, s, f) => +m * 60000 + +s * 1000 + (f ? +String(f).padEnd(3, '0').slice(0, 3) : 0);

    // Enhanced LRC: <mm:ss.xx> before each word.
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
            // Leading tags only; a repeated line can have several.
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

    // NetEase yrc: [lineStart,lineLen](wordStart,wordLen,0)word...
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

    // Musixmatch richsync: ts/te in seconds, word offsets relative to ts.
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

    // Spotify's own lyrics (two endpoints), then Platform.Lyrics.
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

    // LRCLIB: exact match first, search as a fallback.
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

    // NetEase: has word timings. Pick the result closest in length.
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

    // Musixmatch: only with a user token from Settings.
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

    /* Fetch with fallback */

    // Fill in missing line and word durations.
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

    // Hits are kept; misses expire after a minute (often just a network blip).
    const MISS_TTL = 60e3;

    // First synced result wins; unsynced text is kept as a fallback.
    async function fetchLyrics(track) {
        const hit = lyricCache.get(track.uri);
        if (hit && (hit.result || Date.now() - hit.at < MISS_TTL)) return hit.result;

        let fallback = null;
        for (const name of provOrder) {
            if (provOff.has(name)) continue;
            let r = null;
            try { r = await SOURCES[name](track); } catch {}
            if (!r?.lines?.length) continue;

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

    /* Icons (drawn for Wave; SF Symbols can't be used outside Apple platforms) */

    const svg  = (body, cls = '') => `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''}>${body}</svg>`;
    const I_MIN    = svg('<path d="M5.5 12h13"/>', 'st');
    const I_EXP    = svg('<path d="M14 4.5h5.5V10M19.5 4.5 13.5 10.5M10 19.5H4.5V14M4.5 19.5l6-6"/>', 'st');
    const I_COLL   = svg('<path d="M19.5 4.5 14 10m0 0V5.5M14 10h4.5M4.5 19.5 10 14m0 0v4.5M10 14H5.5"/>', 'st');
    const I_X      = svg('<path d="m6.5 6.5 11 11m0-11-11 11"/>', 'st');
    const I_MINI   = svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><path d="m14 10-5 5m0-3.6V15h3.6"/>', 'st');
    const I_DOTS   = svg('<circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/>');
    const I_REW    = svg('<path d="M11.2 6.3a.6.6 0 0 1 .9.5v10.4a.6.6 0 0 1-.9.5L3.4 12.5a.6.6 0 0 1 0-1zm9 0a.6.6 0 0 1 .9.5v10.4a.6.6 0 0 1-.9.5l-7.8-5.2a.6.6 0 0 1 0-1z"/>');
    const I_FF     = svg('<path d="M12.8 6.3a.6.6 0 0 0-.9.5v10.4a.6.6 0 0 0 .9.5l7.8-5.2a.6.6 0 0 0 0-1zm-9 0a.6.6 0 0 0-.9.5v10.4a.6.6 0 0 0 .9.5l7.8-5.2a.6.6 0 0 0 0-1z"/>');
    const I_PLAY3  = '<path d="M7 5.1v13.8a1 1 0 0 0 1.52.85l11.1-6.9a1 1 0 0 0 0-1.7L8.52 4.25A1 1 0 0 0 7 5.1z"/>';
    const I_PAUSE3 = '<rect x="5.5" y="4.5" width="4.6" height="15" rx="1.3"/><rect x="13.9" y="4.5" width="4.6" height="15" rx="1.3"/>';
    const I_LYR    = svg('<path d="M6 4h12a2.5 2.5 0 0 1 2.5 2.5v8.5A2.5 2.5 0 0 1 18 17.5h-5.2L8.4 21v-3.5H6A2.5 2.5 0 0 1 3.5 15V6.5A2.5 2.5 0 0 1 6 4z"/><path d="M9.4 8.6h2.1v2.2c0 1.2-.6 2-1.8 2.5m5.1-4.7h2.1v2.2c0 1.2-.6 2-1.8 2.5"/>', 'st');
    const I_SET    = svg('<path d="M4 7.5h9M18 7.5h2M4 16.5h2M11 16.5h9"/><circle cx="15.5" cy="7.5" r="2.3"/><circle cx="8.5" cy="16.5" r="2.3"/>', 'st');
    const I_LIST   = svg('<circle cx="5" cy="6.5" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="5" cy="17.5" r="1.4"/><path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" class="ln"/>');
    const I_VOL3   = n => svg('<path d="M3.5 9.4h3.2l4.6-4v13.2l-4.6-4H3.5z" class="sp"/>' +
        (n === 0 ? '<path d="m15 9.5 5 5m0-5-5 5"/>'
                 : '<path d="M14.6 9.6a3.4 3.4 0 0 1 0 4.8"/>' + (n > 1 ? '<path d="M17.2 7a7 7 0 0 1 0 10"/>' : '') +
                   (n > 2 ? '<path d="M19.8 4.6a10.4 10.4 0 0 1 0 14.8"/>' : '')), 'st vol');
    const volIcon = v => I_VOL3(v === 0 ? 0 : v < 34 ? 1 : v < 67 ? 2 : 3);

    const I_CLOSE   = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    const I_PLAYER  = '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
    const I_SHUFFLE = '<svg viewBox="0 0 16 16"><path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06l2.306-2.306a.75.75 0 0 0 0-1.06L13.15.922zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"/><path d="m7.5 10.723.98-1.167 1.796 2.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.306 2.306a.75.75 0 0 1 0 1.06l-2.306 2.306a.75.75 0 1 1-1.06-1.06L14.109 14H12.16a3.75 3.75 0 0 1-2.873-1.34l-1.787-2.14z"/></svg>';
    const I_REPEAT  = '<svg viewBox="0 0 16 16"><path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L7.617 13.426a.75.75 0 0 1 0-1.06l2.15-2.152a.75.75 0 1 1 1.062 1.06l-.966.967h1.887A2.25 2.25 0 0 0 14.5 9.75v-5A2.25 2.25 0 0 0 12.25 2.5h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 11.5H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75v-5z"/></svg>';
    const I_NO_LYR  = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';

    // Film grain tile.
    const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

    /* Styles
       Sizes follow Apple's mini player at 440px wide. Slow movement is stepped
       from script: CSS animations redraw at the full refresh rate. */

    const CSS = `
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    :root{--accent:#fc3c44;--pad:22px;}
    html,body{height:100%}
    body{
        font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;
        color:#fff;background:#141417;overflow:hidden;user-select:none;
        -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
    }
    /* Whole window drags, except interactive things. app-region doesn't inherit,
       so it's set on every element. Contents of scroll areas get no region,
       or off-screen rows would punch holes in the header. */
    body *{-webkit-app-region:drag;app-region:drag;}
    button,input,.nd,.pop{-webkit-app-region:no-drag;app-region:no-drag;}
    /* "initial", not "none": this Chrome treats an explicit none as no-drag.
       The toast sits over the play button, so it gets no region either. */
    button *,.nd *,.pop *,#toast{-webkit-app-region:initial;app-region:initial;}
    /* Background layers get no region: the expanded blur reaches 40px past the
       window, and as a drag region it covered the resize border. */
    #bg,#bg *,#xbg,#xbg *,#grain{-webkit-app-region:initial;app-region:initial;}
    /* With a menu open, or the controls hidden, nothing may be a drag region
       (drag regions swallow clicks and mouse moves). */
    body.ov,body.ov *,body.idle,body.idle *{-webkit-app-region:no-drag;app-region:no-drag;}
    /* Full screen sits over Spotify's window, which mustn't be dragged from it. */
    body.v-full,body.v-full *{-webkit-app-region:no-drag;app-region:no-drag;}
    button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;}
    svg{display:block;fill:currentColor;}
    svg.st{fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;}
    svg.vol .sp{fill:currentColor;stroke:currentColor;}
    svg .ln{stroke:currentColor;stroke-width:1.75;stroke-linecap:round;fill:none;}

    /* Background: WebGL swirl at half resolution (it's all blur). */
    #bg{position:fixed;inset:0;z-index:0;overflow:hidden;}
    #bgc{position:absolute;inset:0;width:100%;height:100%;filter:saturate(2) brightness(.7);}
    /* Fallback without WebGL: the blurred cover. */
    .bgl{position:absolute;inset:0;opacity:0;visibility:hidden;
        transition:opacity 1s ease,visibility 0s linear 1s;}
    .bgl.show{opacity:1;visibility:visible;transition:opacity 1s ease,visibility 0s;}
    .bgi{position:absolute;inset:-28%;background-size:cover;background-position:center;
        filter:blur(48px) saturate(1.7) brightness(.62);}
    body.gl .bgl{display:none;}
    #grain{position:fixed;inset:0;z-index:3;pointer-events:none;opacity:.05;
        background-image:${GRAIN};background-size:160px 160px;}

    /* Expanded: full-window artwork, blurred and darkened at the bottom. */
    #xbg{position:fixed;inset:0;z-index:1;display:none;overflow:hidden;}
    body.v-expanded #xbg{display:block;}
    body.v-expanded #bg{display:none;}
    #xArt{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
    #xBlur{position:absolute;inset:-40px;background-size:cover;background-position:center;
        filter:blur(26px) saturate(1.25) brightness(.78);
        -webkit-mask-image:linear-gradient(to bottom,transparent 48%,#000 76%);
        mask-image:linear-gradient(to bottom,transparent 48%,#000 76%);}
    /* Canvas video, cropped to the square. When playing, the bottom blurs the video itself. */
    #xVid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;
        transition:opacity .5s ease;}
    body.canvas #xVid{opacity:1;}
    body.canvas #xBlur{background-image:none !important;filter:none;
        -webkit-backdrop-filter:blur(26px) saturate(1.25) brightness(.78);
        backdrop-filter:blur(26px) saturate(1.25) brightness(.78);}
    #xShade{position:absolute;inset:0;
        background:linear-gradient(to bottom,rgba(0,0,0,.22) 0,transparent 16%,transparent 50%,rgba(0,0,0,.4) 100%);}

    #main{position:relative;z-index:2;height:100%;display:flex;flex-direction:column;
        padding:0 var(--pad) 12px;}

    /* Window controls */
    #wc{position:absolute;top:5px;right:10px;z-index:6;display:flex;gap:22px;}
    .wb{width:28px;height:24px;display:grid;place-items:center;border-radius:6px;
        color:rgba(255,255,255,.66);transition:color .12s,background .12s;}
    .wb:hover{color:#fff;background:rgba(255,255,255,.12);}
    .wb svg{width:15px;height:15px;}

    /* Artwork and titles */
    #top{display:flex;align-items:center;gap:20px;padding-top:20px;flex:none;}
    #artBox{width:75px;height:75px;flex:none;border-radius:6px;overflow:hidden;
        background:rgba(255,255,255,.08);box-shadow:0 4px 14px rgba(0,0,0,.32);}
    #art{width:100%;height:100%;object-fit:cover;display:block;}
    #meta{flex:1;min-width:0;margin-right:64px;position:relative;text-align:center;}
    .ttl{font-size:15px;font-weight:700;letter-spacing:-.01em;line-height:20px;}
    .sub{font-size:15px;font-weight:400;letter-spacing:-.01em;line-height:20px;
        color:rgba(255,255,255,.62);margin-top:4px;}
    #mini{display:none;position:absolute;left:-17px;top:50%;margin-top:-12px;}

    /* Scrolling titles */
    .mq{overflow:hidden;white-space:nowrap;}
    .mq>span{display:inline-block;white-space:nowrap;}
    .mq.on{text-align:left;
        -webkit-mask-image:linear-gradient(90deg,transparent 0,#000 6px,#000 calc(100% - 14px),transparent);
        mask-image:linear-gradient(90deg,transparent 0,#000 6px,#000 calc(100% - 14px),transparent);}
    /* Scrolls there and back twice, then rests. */
    .mq.on>span{padding-left:6px;animation:mq var(--mqd,9s) ease-in-out 2s 4 alternate;}
    @keyframes mq{from{transform:translateX(0)}to{transform:translateX(var(--mqx,0))}}
    @media (prefers-reduced-motion:reduce){.mq.on>span{animation:none}}

    /* Progress */
    #bottom{flex:none;}
    #prog{display:flex;align-items:center;gap:6px;margin:14px 4px 0;}
    .tm{width:50px;flex:none;font-size:12px;color:rgba(255,255,255,.62);
        font-variant-numeric:tabular-nums;letter-spacing:.01em;}
    #tRem{text-align:right;}
    #bar{flex:1;height:16px;display:flex;align-items:center;cursor:pointer;}
    #track{position:relative;width:100%;height:4px;border-radius:2px;overflow:hidden;
        background:rgba(255,255,255,.22);transition:height .15s ease;}
    #bar:hover #track,#bar.drag #track{height:6px;border-radius:3px;}
    #fill{position:absolute;inset:0;border-radius:inherit;background:rgba(255,255,255,.92);
        transform:translateX(-100%);}

    /* Controls */
    #ctrls{display:flex;align-items:center;justify-content:space-between;margin:10px 4px 0 8px;height:40px;}
    .grp{display:flex;align-items:center;}
    .grp.l{gap:13px;} .grp.r{gap:16px;} .grp.c{gap:8px;}
    .cb{width:40px;height:34px;display:grid;place-items:center;border-radius:7px;
        color:rgba(255,255,255,.74);transition:color .12s,background .12s,transform .12s;}
    .cb:hover{color:#fff;}
    .cb:active{transform:scale(.9);}
    .cb svg{width:24px;height:24px;}
    .cb.on{color:#fff;background:rgba(255,255,255,.17);}
    .tb{width:44px;height:40px;display:grid;place-items:center;color:#fff;border-radius:8px;
        transition:transform .12s,opacity .12s;}
    .tb:active{transform:scale(.88);}
    .tb svg{width:31px;height:31px;filter:drop-shadow(0 1px 4px rgba(0,0,0,.25));}
    #bPlay svg{width:30px;height:30px;}

    /* Expanded layout */
    body.v-expanded #top{margin-top:auto;padding-top:0;display:block;}
    body.v-expanded #artBox{display:none;}
    body.v-expanded #meta{margin:0;padding:0 40px;}
    body.v-expanded #mini{display:grid;}
    body.v-expanded #main{padding-bottom:20px;}
    body.v-expanded #prog{margin-top:19px;}
    /* Auto-hide: controls fade; titles move into the free space (offsets set in remeasure()). */
    .chrome{transition:opacity .45s ease;}
    body.idle .chrome{opacity:0;}
    #top,#xBlur,#artBox,#meta{transition:transform .55s cubic-bezier(.3,.9,.4,1);}
    body.v-compact.idle #top{transform:translate3d(0,var(--cdy,0),0);}
    body.v-compact.idle #artBox{transform:translate3d(var(--cax,0),0,0);}
    body.v-compact.idle #meta{transform:translate3d(var(--cmx,0),0,0);}
    body.v-expanded.idle #top{transform:translate3d(0,var(--xdy,0),0);}
    /* The shade stays put: moving it exposed a strip at the top. */
    body.v-expanded.idle #xBlur{transform:translate3d(0,var(--xdy,0),0);}
    @media (prefers-reduced-motion:reduce){#top,#xBlur,#artBox,#meta{transition:none}}

    /* Full screen: artwork and controls on the left, lyrics (or Up Next) on the right. */
    body.v-full{--col:min(60vh,40vw);}
    body.v-full #main{display:grid;grid-template-columns:var(--col);grid-template-rows:1fr auto auto 1fr;
        justify-content:center;column-gap:8vw;padding:0 6vw;}
    body.v-full.p #main{grid-template-columns:var(--col) minmax(0,1000px);}
    body.v-full #top{grid-area:2/1;display:block;padding:0;}
    body.v-full #bottom{grid-area:3/1;zoom:1.45;}
    body.v-full #artBox{position:relative;width:100%;height:auto;aspect-ratio:1;border-radius:12px;
        box-shadow:0 24px 60px rgba(0,0,0,.45);}
    body.v-full #xVid{z-index:1;}
    /* The ⋯ menu sits beside the titles. */
    body.v-full #meta{margin:28px 4px 0;padding-right:52px;text-align:left;}
    body.v-full #meta #bDots{position:absolute;right:-6px;top:50%;margin-top:-17px;}
    body.v-full .ttl{font-size:26px;line-height:32px;}
    body.v-full .sub{font-size:22px;line-height:28px;margin-top:2px;}
    body.v-full #mini,body.v-full #wMin,body.v-full #wExp,body.v-full .grp.l,body.v-full .grp.r{display:none;}
    body.v-full #wc{left:18px;right:auto;top:16px;}
    body.v-full .wb{width:36px;height:32px;}
    body.v-full .wb svg{width:18px;height:18px;}
    /* Shuffle, previous, play, next, repeat. */
    body.v-full #ctrls{justify-content:center;margin:12px 0 0;}
    body.v-full .grp.c{gap:20px;}
    body.v-full .grp.c .qb{width:36px;height:30px;background:none;color:rgba(255,255,255,.62);}
    body.v-full .grp.c .qb svg{width:16px;height:16px;}
    body.v-full .grp.c .qb:hover{color:#fff;}
    body.v-full .grp.c .qb.on{color:#fff;background:rgba(255,255,255,.17);}
    body.v-full .grp.c .qb.off{opacity:.3;}
    /* Volume: the slider sits under the controls instead of a popover. */
    body.v-full #volPop{position:static;display:flex;width:auto;margin:12px 4px 0;padding:0;border-radius:0;
        background:none;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;}
    body.v-full #vPct{display:none;}
    /* Lyrics and Settings, bottom right. */
    #fc{position:absolute;right:22px;bottom:18px;z-index:6;display:flex;gap:12px;}
    body.v-full #wc,#fc{zoom:1.4;}
    body.v-full.p #panel{display:flex;grid-area:1/2/5/3;margin:0;height:100vh;}
    body.v-full .lyric{font-size:calc(var(--lsz,24px) * 2);}
    body.v-full #lyrScroll{padding:42vh 56px 50vh;}
    body.v-full #pvSettings{zoom:1.3;padding-top:12vh;}
    body:not(.v-full) .fullOnly{display:none !important;}
    /* Lyrics only: no cover or controls, lyrics across the middle. */
    body.v-full.lo #top,body.v-full.lo #bottom,body.v-full.lo #bLyr{display:none;}
    body.v-full.lo #main{grid-template-columns:minmax(0,1400px);}
    body.v-full.lo #panel{grid-area:1/1/5/2;}
    body.v-full.lo #pvSettings{width:100%;max-width:760px;margin:0 auto;}
    body.v-full .pipOnly{display:none !important;}
    #offRow #lyrOff{position:static;opacity:1;background:rgba(255,255,255,.1);}
    /* Idle: only the corner buttons and the pointer go. */
    body.v-full.idle #bottom{opacity:1;}
    body.v-full.idle,body.v-full.idle *{cursor:none;}

    /* Panels: lyrics, Up Next, Settings */
    #panel{display:none;flex:1;min-height:0;margin:14px calc(var(--pad) * -1) 0;position:relative;}
    body.v-panel #panel{display:flex;}
    .pv{display:none;flex:1;min-height:0;flex-direction:column;}
    .pv.show{display:flex;}

    /* Lyrics */
    /* Timing nudge: shows while the pointer is over the lyrics, or when set. */
    #pvLyrics{position:relative;}
    #lyrOff{position:absolute;right:14px;bottom:6px;z-index:2;display:flex;align-items:center;gap:2px;padding:2px;
        border-radius:999px;background:rgba(0,0,0,.22);opacity:0;transition:opacity .2s;}
    #pvLyrics:hover #lyrOff,#lyrOff.set{opacity:1;}
    #lyrOff button{width:24px;height:22px;border-radius:999px;font-size:15px;line-height:1;color:rgba(255,255,255,.85);}
    #lyrOff button:hover{background:rgba(255,255,255,.15);}
    #offVal{font-size:11px;min-width:38px;text-align:center;color:rgba(255,255,255,.75);font-variant-numeric:tabular-nums;}
    #lyrWrap{flex:1;min-height:0;position:relative;overflow:hidden;
        -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 44px,#000 calc(100% - 56px),transparent 100%);
        mask-image:linear-gradient(to bottom,transparent 0,#000 44px,#000 calc(100% - 56px),transparent 100%);}
    #lyrScroll{height:100%;overflow-y:auto;overflow-x:hidden;padding:30px 26px 40%;scrollbar-width:none;}
    #lyrScroll::-webkit-scrollbar{display:none;}
    #lyrScroll.centered .lyric{text-align:center;transform-origin:center center;}
    .lyric{font-size:var(--lsz,24px);font-weight:800;letter-spacing:-.022em;line-height:1.24;
        color:rgba(255,255,255,.28);padding:10px 0;cursor:pointer;
        transform-origin:left center;transform:scale(.95);filter:blur(1.4px);
        transition:color .42s cubic-bezier(.4,0,.2,1),filter .42s cubic-bezier(.4,0,.2,1),
                   transform .42s cubic-bezier(.34,1.3,.4,1);}
    .lyric:hover{color:rgba(255,255,255,.6) !important;filter:blur(0) !important;}
    .lyric.past{color:rgba(255,255,255,.34);filter:blur(.7px);}
    .lyric.active{color:#fff;transform:scale(1.04);filter:blur(0);will-change:transform;
        text-shadow:0 0 30px rgba(255,255,255,.18);}
    .lyric.kara{white-space:pre-wrap;}
    .lyric.kara.active .w{
        background-image:linear-gradient(90deg,#fff 0 var(--p,0%),rgba(255,255,255,.36) var(--p,0%) 100%);
        -webkit-background-clip:text;background-clip:text;
        -webkit-text-fill-color:transparent;color:transparent;}
    .lyric.kara.active .w.done{-webkit-text-fill-color:#fff;color:#fff;background-image:none;}
    .lyric.kara.active{text-shadow:none;}
    @media (prefers-reduced-motion:reduce){
        .lyric{transition:color .3s;transform:none !important}
        .lyric.kara.active .w{-webkit-text-fill-color:#fff;color:#fff;background-image:none;}
    }

    /* Up Next */
    .qhead{display:flex;align-items:center;justify-content:space-between;padding:4px var(--pad) 8px;}
    .qtitle{font-size:15px;font-weight:700;letter-spacing:-.01em;}
    .qbtns{display:flex;gap:8px;}
    .qb{position:relative;width:34px;height:26px;border-radius:7px;display:grid;place-items:center;
        color:rgba(255,255,255,.74);background:rgba(255,255,255,.1);transition:background .12s,color .12s;}
    .qb svg{width:14px;height:14px;}
    .qb:hover{background:rgba(255,255,255,.16);}
    .qb.off{opacity:.35;cursor:default;background:rgba(255,255,255,.1);}
    .qb.on{color:#141417;background:rgba(255,255,255,.9);}
    .qb .bdg{position:absolute;top:1px;right:3px;font-size:8px;font-weight:800;display:none;}
    .qb.b .bdg{display:block;}
    #qList{flex:1;min-height:0;overflow-y:auto;padding:0 0 16px;scrollbar-width:thin;
        scrollbar-color:rgba(255,255,255,.2) transparent;}
    .qs{font-size:12px;font-weight:600;color:rgba(255,255,255,.5);padding:10px var(--pad) 4px;}
    .qi{display:flex;align-items:center;gap:11px;padding:5px var(--pad);cursor:pointer;}
    .qi:hover{background:rgba(255,255,255,.07);}
    .qi img{width:38px;height:38px;border-radius:4px;object-fit:cover;flex:none;background:rgba(255,255,255,.08);}
    .qt{flex:1;min-width:0;}
    .qn,.qa{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .qn{font-size:13.5px;font-weight:500;}
    .qa{font-size:12.5px;color:rgba(255,255,255,.58);margin-top:1px;}
    .qd{font-size:12px;color:rgba(255,255,255,.45);font-variant-numeric:tabular-nums;}

    /* Settings */
    #sBody{flex:1;min-height:0;overflow-y:auto;padding:0 16px 16px;scrollbar-width:none;}
    .shd{display:flex;align-items:center;justify-content:space-between;padding:4px var(--pad) 8px;}
    .sdone{font-size:13px;font-weight:600;padding:4px 10px;border-radius:7px;background:rgba(255,255,255,.12);}
    .sdone:hover{background:rgba(255,255,255,.2);}
    .sbtn{font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:7px;background:rgba(255,255,255,.12);}
    .sbtn:hover{background:rgba(255,255,255,.2);}
    .scard{background:rgba(255,255,255,.07);border-radius:12px;padding:2px 14px;
        box-shadow:inset 0 0 0 .5px rgba(255,255,255,.1);}
    .sr{display:flex;align-items:center;justify-content:space-between;padding:11px 0;gap:10px;}
    .sr + .sr{border-top:1px solid rgba(255,255,255,.07);}
    .slbl{font-size:13.5px;font-weight:500;color:rgba(255,255,255,.9);}
    .stitle{font-size:11.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;
        color:rgba(255,255,255,.45);padding:16px 4px 6px;}
    .shint{font-size:11.5px;color:rgba(255,255,255,.45);padding:8px 4px 0;line-height:1.45;}
    .tog{width:38px;height:22px;background:rgba(255,255,255,.18);border-radius:11px;position:relative;
        cursor:pointer;flex:none;transition:background .2s;}
    .tog.on{background:var(--accent);}
    .tog::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;background:#fff;
        border-radius:50%;transition:transform .2s cubic-bezier(.34,1.3,.5,1);box-shadow:0 1px 4px rgba(0,0,0,.3);}
    .tog.on::after{transform:translateX(16px);}
    .fsrow{display:flex;align-items:center;gap:10px;}
    .fsslider{width:110px;accent-color:#fff;}
    .fsval{font-size:12px;color:rgba(255,255,255,.5);min-width:32px;text-align:right;font-variant-numeric:tabular-nums;}
    .prow{gap:10px;justify-content:flex-start;}
    .prow .slbl{flex:1;}
    .num{font-size:12px;font-weight:700;color:rgba(255,255,255,.45);width:12px;}
    .pup{width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.12);font-size:10px;flex:none;}
    .pup:disabled{opacity:.25;cursor:default;}
    .stok{background:rgba(0,0,0,.3);border:0;outline:none;color:#fff;border-radius:7px;padding:6px 9px;
        font-size:12px;width:140px;font-family:ui-monospace,Consolas,monospace;}

    /* Menus: frosted glass tinted with the cover colour (--tint, set per song). */
    #scrim{position:fixed;inset:0;z-index:20;display:none;}
    .pop,#toast{background:var(--tint,rgba(40,40,46,.6));
        -webkit-backdrop-filter:blur(26px) saturate(1.6);backdrop-filter:blur(26px) saturate(1.6);
        box-shadow:0 12px 32px rgba(0,0,0,.35),inset 0 0 0 .5px rgba(255,255,255,.18),inset 0 .5px 0 rgba(255,255,255,.22);}
    .pop{position:fixed;z-index:21;display:none;border-radius:12px;}
    #menu{padding:5px;min-width:200px;overflow-y:auto;scrollbar-width:none;}
    .mi{display:flex;align-items:center;width:100%;text-align:left;font-size:13px;padding:4px 10px;
        border-radius:7px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .mi:hover{background:rgba(255,255,255,.16);}
    .mi:disabled{opacity:.35;pointer-events:none;}
    .mi .chev{margin-left:auto;padding-left:14px;opacity:.6;}
    .msep{height:1px;margin:4px 8px;background:rgba(255,255,255,.14);}
    #volPop{padding:8px 12px;display:none;align-items:center;gap:10px;width:220px;border-radius:999px;}
    #volPop.show{display:flex;}
    #vMute{width:26px;height:26px;display:grid;place-items:center;color:rgba(255,255,255,.8);}
    #vMute svg{width:19px;height:19px;}
    #vol{-webkit-appearance:none;appearance:none;flex:1;height:4px;border-radius:2px;outline:none;cursor:pointer;
        background:linear-gradient(90deg,rgba(255,255,255,.92) var(--v,50%),rgba(255,255,255,.22) var(--v,50%));}
    #vol::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#fff;
        box-shadow:0 1px 4px rgba(0,0,0,.4);}
    #vPct{font-size:11px;color:rgba(255,255,255,.55);width:26px;text-align:right;font-variant-numeric:tabular-nums;}

    #toast{position:fixed;left:50%;bottom:14px;z-index:30;transform:translate(-50%,8px);opacity:0;
        pointer-events:none;font-size:12.5px;font-weight:500;padding:6px 12px;border-radius:999px;
        transition:opacity .2s,transform .2s;}
    #toast.show{opacity:1;transform:translate(-50%,0);}

    .status{display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:34px 0;gap:10px;opacity:.5;}
    .status svg{width:28px;height:28px;}
    .status .msg{font-size:13px;font-weight:600;}
    .spinner{width:22px;height:22px;border:2.5px solid rgba(255,255,255,.12);
        border-top-color:rgba(255,255,255,.65);border-radius:50%;animation:spin .65s linear infinite;}
    @keyframes spin{to{transform:rotate(360deg)}}
    `;

    /* Markup: one set of elements for every view; body classes rearrange them. */

    function buildHtml() {
        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><title>WavePlayer</title>
<style>${CSS}</style></head><body>

<div id="bg">
  <canvas id="bgc"></canvas>
  <div class="bgl" id="bgA"><div class="bgi" id="bgAi"></div></div>
  <div class="bgl" id="bgB"><div class="bgi" id="bgBi"></div></div>
</div>
<div id="xbg"><img id="xArt" alt="" draggable="false"><video id="xVid" muted loop playsinline preload="auto"></video><div id="xBlur"></div><div id="xShade"></div></div>
<div id="grain"></div>

<div id="main">
  <div id="top">
    <div id="artBox"><img id="art" alt="Album art" draggable="false"></div>
    <div id="meta">
      <button class="wb chrome" id="mini" title="Back to mini player" aria-label="Back to mini player">${I_MINI}</button>
      <div class="ttl mq" id="ttlW"><span id="ttl">Loading…</span></div>
      <div class="sub mq" id="subW"><span id="sub">—</span></div>
    </div>
  </div>

  <div id="panel" class="nd">
    <div class="pv" id="pvLyrics">
      <div id="lyrWrap"><div id="lyrScroll" class="${centerLyrics ? 'centered' : ''}" style="--lsz:${fontSize}px"></div></div>
      <div id="lyrOff" title="Lyrics timing">
        <button id="offMinus" title="Lyrics earlier" aria-label="Lyrics earlier">−</button>
        <span id="offVal">0.0s</span>
        <button id="offPlus" title="Lyrics later" aria-label="Lyrics later">+</button>
      </div>
    </div>
    <div class="pv" id="pvQueue">
      <div class="qhead"><span class="qtitle">Playing Next</span>
        <div class="qbtns">
          <button class="qb" id="qShuf" title="Shuffle" aria-label="Shuffle">${I_SHUFFLE}<span class="bdg">✦</span></button>
          <button class="qb" id="qRep" title="Repeat" aria-label="Repeat">${I_REPEAT}<span class="bdg">1</span></button>
        </div></div>
      <div id="qList"></div>
    </div>
    <div class="pv" id="pvSettings">
      <div class="shd"><span class="qtitle">Settings</span><button class="sdone" id="sDone">Done</button></div>
      <div id="sBody">
        <div class="stitle fullOnly" style="padding-top:2px">Full screen</div>
        <div class="scard fullOnly">
          <div class="sr"><span class="slbl">Lyrics only</span><div class="tog ${lyricsOnly?'on':''}" id="togLo"></div></div>
        </div>
        <div class="shint fullOnly">Hides the cover and controls. Space plays and pauses, the arrow keys skip 5 seconds.</div>
        <div class="stitle" style="padding-top:2px">Background</div>
        <div class="scard">
          <div class="sr"><span class="slbl">Movement speed</span>
            <div class="fsrow"><input type="range" class="fsslider" id="swSlider" min="0" max="3" step="0.25" value="${swirlSpeed}"><span class="fsval" id="swVal">${swirlSpeed === 0 ? 'Still' : swirlSpeed + '×'}</span></div></div>
        </div>

        <div class="stitle">Expanded view</div>
        <div class="scard">
          <div class="sr"><span class="slbl">Animated covers</span><div class="tog ${canvasOn?'on':''}" id="togCanvas"></div></div>
        </div>
        <div class="shint">Spotify's looping video for songs that have one. Other songs keep the cover.</div>

        <div class="stitle">Lyrics</div>
        <div class="scard">
          <div class="sr"><span class="slbl">Center lyrics</span><div class="tog ${centerLyrics?'on':''}" id="togCenter"></div></div>
          <div class="sr"><span class="slbl">Lyrics size</span>
            <div class="fsrow"><input type="range" class="fsslider" id="fsSlider" min="14" max="40" value="${fontSize}"><span class="fsval" id="fsVal">${fontSize}px</span></div></div>
          <div class="sr fullOnly" id="offRow"><span class="slbl">Timing for this song</span></div>
        </div>
        <div class="stitle pipOnly">Auto-hide controls</div>
        <div class="scard pipOnly">
          <div class="sr"><span class="slbl">Compact</span><div class="tog ${autoHide.compact?'on':''}" data-ah="compact"></div></div>
          <div class="sr"><span class="slbl">Expanded</span><div class="tog ${autoHide.expanded?'on':''}" data-ah="expanded"></div></div>
          <div class="sr"><span class="slbl">Lyrics</span><div class="tog ${autoHide.lyrics?'on':''}" data-ah="lyrics"></div></div>
        </div>
        <div class="shint pipOnly">Controls fade after a few seconds without the mouse moving, and come back when it does.</div>

        <div class="stitle">Lyric sources</div>
        <div class="scard">
          <div class="sr"><span class="slbl">Word-by-word sync</span><div class="tog ${karaoke?'on':''}" id="togKara"></div></div>
          <div id="provList"></div>
          <div class="sr"><span class="slbl">Musixmatch token</span>
            <input class="stok" id="mxmTok" type="password" placeholder="optional" value="${mxmToken.replace(/[^\w.-]/g,'')}" spellcheck="false"></div>
        </div>
        <div class="shint">Sources are tried top to bottom until one has synced lyrics.
          NetEase and Musixmatch are the ones that carry word timings.</div>

        <div class="stitle pipOnly">Window</div>
        <div class="scard pipOnly">
          <div class="sr"><span class="slbl">Window sizes</span><button class="sbtn" id="sizeReset">Reset</button></div>
        </div>
        <div class="shint pipOnly">Each view remembers the size you resize it to. Reset puts them all back.</div>
      </div>
    </div>
  </div>

  <div id="bottom" class="nd chrome">
    <div id="prog">
      <span class="tm" id="tEl">0:00</span>
      <div id="bar"><div id="track"><div id="fill"></div></div></div>
      <span class="tm" id="tRem">-0:00</span>
    </div>
    <div id="ctrls">
      <div class="grp l">
        <button class="cb" id="bVol" title="Volume" aria-label="Volume">${volIcon(50)}</button>
        <button class="cb" id="bDots" title="More" aria-label="More options">${I_DOTS}</button>
      </div>
      <div class="grp c">
        <button class="tb" id="bPrev" title="Previous" aria-label="Previous">${I_REW}</button>
        <button class="tb" id="bPlay" title="Play" aria-label="Play"><svg viewBox="0 0 24 24" id="playIco">${I_PLAY3}</svg></button>
        <button class="tb" id="bNext" title="Next" aria-label="Next">${I_FF}</button>
      </div>
      <div class="grp r">
        <button class="cb" id="bLyr" title="Lyrics" aria-label="Lyrics">${I_LYR}</button>
        <button class="cb" id="bList" title="Playing Next" aria-label="Playing Next">${I_LIST}</button>
      </div>
    </div>
  </div>
</div>

<!-- After #main: later drag regions win, so these buttons must come after it. -->
<div id="wc" class="chrome">
  <button class="wb" id="wMin" title="Close player" aria-label="Close player">${I_MIN}</button>
  <button class="wb" id="wExp" title="Expand" aria-label="Expand">${I_EXP}</button>
  <button class="wb" id="wClose" title="Close player" aria-label="Close player">${I_X}</button>
</div>

<div id="scrim"></div>
<div id="menu" class="pop" role="menu"></div>
<div id="volPop" class="pop">
  <button id="vMute" title="Mute" aria-label="Mute">${volIcon(50)}</button>
  <input type="range" id="vol" min="0" max="100" value="50" aria-label="Volume">
  <span id="vPct">50</span>
</div>
<div id="toast"></div>
</body></html>`;
    }

    /* PiP window */

    async function openPip() {
        // Clicking the launcher again closes it.
        if (pipWindow && !pipWindow.closed) { pipWindow.close(); pipWindow = null; return; }
        if (!('documentPictureInPicture' in window)) {
            Spicetify.showNotification('WavePlayer: this Spotify version has no picture-in-picture support. Update Spotify.', true);
            return;
        }
        currentTrackUri = null;
        // Only one PiP window is allowed; close Spotify's own first.
        const held = window.documentPictureInPicture.window;
        if (held && !held.closed) {
            try { held.close(); } catch {}
            await new Promise(r => setTimeout(r, 60));
        }
        try {
            const sz = SZ[mode] || SZ.compact;
            // Ignore the size Chrome remembers from the last PiP window.
            pipWindow = await window.documentPictureInPicture.requestWindow({
                width: sz.w, height: sz.h, preferInitialWindowPlacement: true,
            });
            // Back where it was last closed, kept on screen.
            try {
                const p = JSON.parse(localStorage.getItem('wp7-pos') || 'null'), sc = window.screen;
                if (p) pipWindow.moveTo(
                    Math.max(sc.availLeft || 0, Math.min(p.x, (sc.availLeft || 0) + sc.availWidth - sz.w)),
                    Math.max(sc.availTop || 0, Math.min(p.y, (sc.availTop || 0) + sc.availHeight - sz.h)));
            } catch {}
            setupPip(pipWindow);
        } catch (e) {
            console.warn('[WavePlayer]', e);
            Spicetify.showNotification(`WavePlayer: couldn't open the player: ${e?.message || e}`, true);
        }
    }

    // Spicetify 2.45 bug workaround: its scroll fix re-checks every untagged element on each
    // DOM change (~95ms) because its version check fails on Spotify 1.3. Tagging elements
    // it has already checked keeps that cheap while the player is open.
    const scrollFixRuns = () => {
        const v = String(Spicetify.Platform?.version || '').split('.').map(Number);
        return !(v[1] >= 2 && v[2] >= 57);
    };
    const tagScanned = () => {
        for (const n of document.querySelectorAll('*:not([data-scroll-optimized])')) n.setAttribute('data-scroll-optimized', '');
    };

    // full: the full-screen view, drawn in a frame over Spotify's window instead of a PiP window.
    function setupPip(win, full = false) {
        const doc = win.document;
        // A frame's own visibility can stay hidden; full screen follows Spotify's window.
        const visDoc = full ? document : doc;
        const hidden = () => visDoc.hidden;
        const sp  = Spicetify.Player;
        const P   = Spicetify.Platform;

        doc.write(buildHtml());
        doc.close();

        const el = {};
        for (const node of doc.querySelectorAll('[id]')) el[node.id] = node;
        const body = doc.body;

        // Spotify injects its own mini player stylesheets into every PiP window; remove them.
        const dropForeignCss = () => { for (const l of doc.querySelectorAll('link[rel="stylesheet"]')) l.remove(); };
        dropForeignCss();
        const cssGuard = new win.MutationObserver(dropForeignCss);
        cssGuard.observe(doc.head, { childList: true });
        cssGuard.observe(body, { childList: true });

        let view  = null;   // compact | expanded | panel | full
        let panel = null;   // null | lyrics | queue | settings

        let playing = false, durMs = 0, shuffle = 0, repeat = 0, curItem = null, limits = null;

        const curPos = () => sp.getProgress?.() ?? 0;

        // Per-song timing offset in ms (positive = lyrics later). Kept for the last 200 songs.
        let lyrOffset = 0;
        const lyrPos = () => curPos() - lyrOffset;
        const offsets = () => { try { return JSON.parse(localStorage.getItem('wp7-lyr-offset') || '{}'); } catch { return {}; } };
        function showOffset() {
            el.offVal.textContent = `${lyrOffset > 0 ? '+' : ''}${(lyrOffset / 1000).toFixed(2).replace(/0$/, '')}s`;
            el.lyrOff.classList.toggle('set', lyrOffset !== 0);
        }
        function loadOffset(uri) { lyrOffset = offsets()[uri] || 0; showOffset(); }
        function nudge(ms) {
            lyrOffset = Math.max(-10000, Math.min(10000, lyrOffset + ms));
            const all = offsets();
            delete all[currentTrackUri];
            if (lyrOffset) all[currentTrackUri] = lyrOffset;
            const keys = Object.keys(all);
            if (keys.length > 200) delete all[keys[0]];
            localStorage.setItem('wp7-lyr-offset', JSON.stringify(all));
            showOffset();
            lyr.idx = -1;
            updateLyrics(lyrPos());
        }
        el.offMinus.onclick = () => nudge(-250);
        el.offPlus.onclick  = () => nudge(250);

        const clamp01 = n => Math.max(0, Math.min(1, n));
        const toHttp = u => u?.startsWith('spotify:image:') ? `https://i.scdn.co/image/${u.slice(14)}` : (u || '');
        const imgOf = (item, label) => {
            const imgs = item?.album?.images || item?.images || [];
            const pick = imgs.find(i => i.label === label) || imgs.find(i => i.label === 'large') || imgs[0];
            return toHttp(pick?.url || item?.metadata?.image_xlarge_url || item?.metadata?.image_url || '');
        };
        const artistsOf = item => item?.artists?.map(a => a.name).join(', ') || artistOf(item) || '';
        const fmtUp = ms => fmt(Math.ceil(Math.max(0, ms) / 1000) * 1000);

        let toastTimer = null;
        const toast = msg => {
            el.toast.textContent = msg;
            el.toast.classList.add('show');
            win.clearTimeout(toastTimer);
            toastTimer = win.setTimeout(() => el.toast.classList.remove('show'), 1600);
        };

        /* Views */

        // Resize by the difference and re-check for a moment: outerWidth can be stale
        // on a PiP window, and the first resize sometimes lands a little off.
        let want = null, sizeTimer = null, sizingUntil = 0, saveTimer = null, burst = 0;
        const openedAt = win.performance.now();
        const SIZE_CHECKS = [0, 120, 250, 450, 750, 1200, 2000];
        function resize(sz) {
            if (full) return;
            want = sz;
            sizingUntil = win.performance.now() + 2500;
            win.clearTimeout(sizeTimer);
            let i = 0;
            const step = () => {
                const dw = want.w - win.innerWidth, dh = want.h - win.innerHeight;
                if (dw || dh) { try { win.resizeBy(dw, dh); } catch {} }
                else keepOnScreen();
                if (++i < SIZE_CHECKS.length) sizeTimer = win.setTimeout(step, SIZE_CHECKS[i] - SIZE_CHECKS[i - 1]);
            };
            step();
        }

        // Keep the window on screen when it grows.
        function keepOnScreen() {
            const sc = win.screen;
            const right = (sc.availLeft || 0) + sc.availWidth, bottom = (sc.availTop || 0) + sc.availHeight;
            const dx = Math.min(0, right - (win.screenX + win.outerWidth));
            const dy = Math.min(0, bottom - (win.screenY + win.outerHeight));
            if ((dx || dy) && win.outerWidth < sc.availWidth && win.outerHeight < sc.availHeight) {
                try { win.moveBy(dx, dy); } catch {}
            }
        }

        function layout() {
            closePops();
            if (full && lyricsOnly && !panel) panel = 'lyrics';
            body.classList.toggle('lo', full && lyricsOnly);
            const v = full ? 'full' : panel ? 'panel' : mode;
            body.classList.remove('v-compact', 'v-expanded', 'v-panel');
            body.classList.add(`v-${v}`);
            body.classList.toggle('p', !!panel);
            el.pvLyrics.classList.toggle('show', panel === 'lyrics');
            el.pvQueue.classList.toggle('show', panel === 'queue');
            el.pvSettings.classList.toggle('show', panel === 'settings');
            el.bLyr.classList.toggle('on', panel === 'lyrics');
            el.bList.classList.toggle('on', panel === 'queue');
            // The expand button toggles between compact and expanded.
            const ex = v === 'expanded';
            el.wExp.title = el.wExp.ariaLabel = ex ? 'Back to mini player' : 'Expand';
            el.wExp.innerHTML = ex ? I_COLL : I_EXP;
            // Skip on first layout: requestWindow already sized the window.
            if (v !== view) { if (view) resize(SZ[v]); view = v; }
            if (panel === 'queue') renderQueue();
            if (panel === 'lyrics') { lyr.idx = -1; updateLyrics(lyrPos()); }
            lyricsLoop();
            swirlLoop();
            if (withCanvas() && canvasFor !== currentTrackUri) loadCanvas(currentTrackUri);
            canvasPlay();
            // Re-arm auto-hide for the new view.
            lastWake = -Infinity;
            wake();
            remeasure();
        }

        const setMode = m => {
            mode = m;
            localStorage.setItem('wp7-mode', m);
            panel = null;
            layout();
        };
        const togglePanel = p => { panel = panel === p ? null : p; layout(); };

        const withCanvas = () => view === 'expanded' || view === 'full';
        const closePlayer = () => { if (full) closeFull(); else try { win.close(); } catch {} };

        /* Titles */

        // Scroll a title only if it overflows.
        function marquee(wrap, span, text) {
            if (text != null) span.textContent = text;
            wrap.classList.remove('on');
            win.requestAnimationFrame(() => {
                const ov = span.scrollWidth - wrap.clientWidth;
                if (ov > 4) {
                    span.style.setProperty('--mqx', `-${ov + 20}px`);
                    span.style.setProperty('--mqd', `${Math.max(5, (ov + 20) / 18)}s`);
                    wrap.classList.add('on');
                }
            });
        }
        const remeasure = () => {
            marquee(el.ttlW, el.ttl);
            marquee(el.subW, el.sub);
            // offsetTop/offsetLeft ignore transforms, so idle offsets don't affect this.
            const top = el.top.offsetTop, h = el.top.offsetHeight, H = win.innerHeight, W = win.innerWidth;
            const root = doc.documentElement.style;
            // Compact idle: centre the artwork and titles as one group.
            const art = el.artBox, aw = art.offsetWidth;
            root.setProperty('--cdy', `${Math.round(H / 2 - (art.offsetTop + art.offsetHeight / 2))}px`);
            const mw = el.meta.clientWidth;
            const tw = Math.min(mw, Math.max(el.ttl.offsetWidth, el.sub.offsetWidth));
            const gap = el.meta.offsetLeft - (art.offsetLeft + aw);
            const left = (W - (aw + gap + tw)) / 2;
            root.setProperty('--cax', `${Math.round(left - art.offsetLeft)}px`);
            root.setProperty('--cmx', `${Math.round(left + aw + gap + tw / 2 - (el.meta.offsetLeft + mw / 2))}px`);
            // Expanded idle: titles drop to just above the bottom edge.
            root.setProperty('--xdy', `${Math.max(0, Math.round(H - 24 - (top + h)))}px`);
        };

        /* Background */

        let bgFlip = false, paletteReq = 0;

        function setBackground(img) {
            const next = bgFlip ? el.bgA : el.bgB;
            const cur  = bgFlip ? el.bgB : el.bgA;
            (bgFlip ? el.bgAi : el.bgBi).style.backgroundImage = `url('${img.replace(/'/g, "\\'")}')`;
            next.classList.add('show');
            cur.classList.remove('show');
            bgFlip = !bgFlip;
        }

        /* Swirl
           Beautiful Lyrics-style background: the cover, blurred into a disc, drawn as four
           overlapping circles spinning at different speeds. Capped at 60fps. */

        const SWIRL_FS = `
precision mediump float;
uniform sampler2D uA, uB;
uniform float uMix, uT;
uniform vec4 uC[4];   // circle: centre xy, radius, spin speed (rad per time unit)
uniform vec4 uO;      // circle opacities; the first one is the solid base

vec4 disc(sampler2D tex, vec2 p, vec4 c) {
    vec2 d = (p - c.xy) / c.z;
    if (dot(d, d) > 1.0) return vec4(0.0);
    float a = uT * c.w, s = sin(a), k = cos(a);
    return texture2D(tex, mat2(k, -s, s, k) * d * 0.5 + 0.5);
}

vec3 swirl(sampler2D tex, vec2 p) {
    vec3 col = disc(tex, p, uC[0]).rgb;
    for (int i = 1; i < 4; i++) {
        vec4 s = disc(tex, p, uC[i]);
        col = mix(col, s.rgb, s.a * uO[i]);
    }
    return col;
}

void main() {
    vec2 p = gl_FragCoord.xy;
    gl_FragColor = vec4(mix(swirl(uA, p), swirl(uB, p), uMix), 1.0);
}`;
        const SWIRL_VS = 'attribute vec2 v; void main() { gl_Position = vec4(v, 0.0, 1.0); }';

        let gl = null, glU = null, texA = null, texB = null, fadeFrom = 0, swirlRaf = null, swirlLast = 0;
        let swirlT = 0, swirlPrev = 0;   // swirl clock (frame time × speed); at speed 0, only redraw when something changes
        let swirlDirty = true;

        function initSwirl() {
            try {
                gl = el.bgc.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
                if (!gl) return;
                const sh = (type, src) => {
                    const o = gl.createShader(type);
                    gl.shaderSource(o, src);
                    gl.compileShader(o);
                    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
                    return o;
                };
                const prog = gl.createProgram();
                gl.attachShader(prog, sh(gl.VERTEX_SHADER, SWIRL_VS));
                gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, SWIRL_FS));
                gl.linkProgram(prog);
                if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
                gl.useProgram(prog);
                gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
                const loc = gl.getAttribLocation(prog, 'v');
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
                glU = Object.fromEntries(['uA', 'uB', 'uMix', 'uT', 'uC', 'uO'].map(n => [n, gl.getUniformLocation(prog, n)]));
                gl.uniform1i(glU.uA, 0);
                gl.uniform1i(glU.uB, 1);
                gl.uniform4f(glU.uO, 1, 0.75, 0.5, 0.5);
                const tex = () => {
                    const t = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, t);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 20, 24, 255]));
                    return t;
                };
                texA = tex();
                texB = tex();
                body.classList.add('gl');
                el.bgc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; body.classList.remove('gl'); swirlLoop(); });
                sizeSwirl();
            } catch (e) {
                console.warn('[WavePlayer] swirl unavailable', e);
                gl = null;
            }
        }

        // Circle positions in canvas pixels (y up).
        function sizeSwirl() {
            if (!gl) return;
            const k = (win.devicePixelRatio || 1) / (full ? 4 : 2);
            const W = Math.max(1, Math.round(win.innerWidth * k)), H = Math.max(1, Math.round(win.innerHeight * k));
            el.bgc.width = W;
            el.bgc.height = H;
            gl.viewport(0, 0, W, H);
            swirlDirty = true;
            const L = Math.max(W, H), wide = W > H;
            gl.uniform4fv(glU.uC, [
                W / 2, H / 2, L * 1.5,               -0.25,
                W / 2, H / 2, L * (wide ? 1 : 0.75),  0.5,
                0,     H,     L * 0.75,               1.0,
                W,     0,     L * (wide ? 0.65 : 0.5), -0.75,
            ]);
        }

        // The cover cut to a disc and blurred.
        async function blurredDisc(url) {
            const img = new win.Image();
            img.crossOrigin = 'anonymous';
            img.src = url;
            await img.decode();
            const S = 256, pad = 72, side = Math.min(img.naturalWidth, img.naturalHeight);
            const disc = doc.createElement('canvas');
            disc.width = disc.height = S;
            const d = disc.getContext('2d');
            d.beginPath();
            d.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
            d.clip();
            d.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
            const out = doc.createElement('canvas');
            out.width = out.height = S + pad;
            const o = out.getContext('2d');
            o.filter = 'blur(16px)';
            o.drawImage(disc, pad / 2, pad / 2);
            return out;
        }

        let swirlReq = 0;
        async function setSwirl(url) {
            if (!gl) return;
            const token = ++swirlReq;
            let canvas;
            try { canvas = await blurredDisc(url); } catch { return; }
            if (token !== swirlReq || !gl) return;
            // The current picture becomes A; the new cover fades in as B.
            if (fadeFrom) [texA, texB] = [texB, texA];
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, texB);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texA);
            fadeFrom = win.performance.now();
            swirlDirty = true;
            swirlLoop();
        }

        function drawSwirl(now) {
            let mix = 1;
            if (fadeFrom) {
                mix = Math.min(1, (now - fadeFrom) / 1000);
                if (mix >= 1) {
                    // Fade done: B becomes A.
                    [texA, texB] = [texB, texA];
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, texB);
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, texA);
                    fadeFrom = 0;
                    mix = 0;
                }
            } else mix = 0;
            gl.uniform1f(glU.uMix, mix);
            // Ignore gaps while hidden.
            const dt = swirlPrev ? Math.min(100, now - swirlPrev) : 0;
            swirlPrev = now;
            swirlT += dt * swirlSpeed / 3500;
            gl.uniform1f(glU.uT, swirlT);
            swirlDirty = false;
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        // Only while visible; one frame for reduced motion.
        const still = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
        function swirlLoop() {
            const want = gl && view !== 'expanded' && !hidden();
            if (want && still) { drawSwirl(fadeFrom ? fadeFrom + 1000 : 0); return; }
            if (want && swirlRaf === null) {
                const frame = t => {
                    swirlRaf = win.requestAnimationFrame(frame);
                    if (t - swirlLast < 15) return;
                    if (!swirlSpeed && !fadeFrom && !swirlDirty) { swirlPrev = 0; return; }
                    swirlLast = t;
                    drawSwirl(t);
                };
                swirlRaf = win.requestAnimationFrame(frame);
            } else if (!want && swirlRaf !== null) {
                win.cancelAnimationFrame(swirlRaf);
                swirlRaf = null;
            }
        }

        /* Canvas (animated covers)
           Spotify's Canvas .mp4 is H.264, which the desktop app can't play, so the VP9
           WebM from its video manifest is used instead (segments stitched into one file). */

        const canvasCache = new Map();   // uri -> Blob, or null for "no Canvas"
        let canvasReq = 0, canvasUrl = null, canvasFor = null;   // canvasFor: track the video was loaded for

        async function canvasBlob(uri) {
            if (canvasCache.has(uri)) return canvasCache.get(uri);
            // Only cache real answers; failures (e.g. GraphQL not loaded yet) retry later.
            let blob = null, answered = false;
            try {
                const G = Spicetify.GraphQL;
                if (typeof G?.Request !== 'function') return null;
                const cv = (await G.Request(G.Definitions.canvas, { trackUri: uri }))?.data?.trackUnion?.canvas;
                answered = !cv?.fileId;
                if (cv?.fileId && /^VIDEO/.test(cv.type || '')) {
                    const m = await cos(`https://spclient.wg.spotify.com/manifests/v9/json/sources/${cv.fileId}/options/supports_drm`);
                    const c = m?.contents?.[0];
                    // Smallest WebM at least as wide as the window.
                    const need = win.innerWidth * (win.devicePixelRatio || 1);
                    const webm = (c?.profiles || []).filter(p => p.mime_type === 'video/webm').sort((x, y) => x.video_width - y.video_width);
                    const prof = webm.find(p => p.video_width >= need) || webm[webm.length - 1];
                    const base = m?.base_urls?.[0];
                    if (prof && base) {
                        const fill = (t, o) => t.replace(/{{(\w+)}}/g, (_, k) => o[k]);
                        const urls = [base + fill(m.initialization_template, { profile_id: prof.id, file_type: prof.file_type })];
                        for (let t = c.start_time_millis; t < c.end_time_millis; t += c.segment_length * 1000) {
                            urls.push(base + fill(m.segment_template, { profile_id: prof.id, segment_timestamp: t / 1000, file_type: prof.file_type }));
                        }
                        const parts = await Promise.all(urls.map(async u => {
                            const r = await fetch(u);
                            if (!r.ok) throw new Error(`HTTP ${r.status}`);
                            return r.arrayBuffer();
                        }));
                        blob = new Blob(parts, { type: 'video/webm' });
                    }
                    answered = true;
                }
            } catch {}
            if (answered) {
                if (canvasCache.size > 20) canvasCache.clear();
                canvasCache.set(uri, blob);
            }
            return blob;
        }

        async function loadCanvas(uri) {
            const token = ++canvasReq;
            canvasFor = uri;
            body.classList.remove('canvas');
            el.xVid.pause();
            el.xVid.removeAttribute('src');
            el.xVid.load();
            if (canvasUrl) { win.URL.revokeObjectURL(canvasUrl); canvasUrl = null; }
            if (!canvasOn || !uri?.startsWith('spotify:track:')) return;
            const blob = await canvasBlob(uri);
            if (token !== canvasReq) return;
            if (!blob) {
                // No answer yet: retry while this song is still showing.
                if (!canvasCache.has(uri)) win.setTimeout(() => { if (token === canvasReq && withCanvas()) loadCanvas(uri); }, 3000);
                return;
            }
            canvasUrl = win.URL.createObjectURL(blob);
            el.xVid.src = canvasUrl;
            canvasPlay();
        }

        // Only decode while visible.
        function canvasPlay() {
            if (!el.xVid.getAttribute('src')) return;
            if (withCanvas() && !hidden()) el.xVid.play().catch(() => {});
            else el.xVid.pause();
        }
        el.xVid.addEventListener('playing', () => body.classList.add('canvas'));
        // Stitched WebM has no duration, so loop by hand.
        el.xVid.addEventListener('ended', () => { el.xVid.currentTime = 0; canvasPlay(); });
        el.xVid.addEventListener('error', () => body.classList.remove('canvas'));

        // Ignore results for a track that's already been skipped.
        function requestPalette(img) {
            const token = ++paletteReq;
            getColors(img).then(p => {
                if (token !== paletteReq || !p) return;
                const { dom: d, acc: a } = p;
                const root = doc.documentElement.style;
                root.setProperty('--accent', `rgb(${a.r},${a.g},${a.b})`);
                root.setProperty('--tint', `rgba(${Math.round(d.r*.45)},${Math.round(d.g*.45)},${Math.round(d.b*.45)},.6)`);
                // Shown until the swirl draws.
                body.style.background = `rgb(${Math.round(d.r*.3)},${Math.round(d.g*.3)},${Math.round(d.b*.3)})`;
            });
        }

        /* Liked state */

        // LibraryAPI is reliable; Player.getHeart reads the UI and can lag.
        const lib = () => P?.LibraryAPI;
        let heartUri = null, heartState = false, heartReq = 0;

        async function refreshHeart(uri) {
            if (!uri) return;
            const token = ++heartReq;
            let liked;
            if (lib()?.contains) { try { liked = (await lib().contains(uri))?.[0]; } catch {} }
            if (token !== heartReq) return;
            if (liked == null) liked = uri === currentTrackUri ? !!(sp.getHeart?.()) : heartState;
            heartUri = uri;
            heartState = !!liked;
        }

        async function toggleHeart() {
            const uri = currentTrackUri;
            if (!uri) return;
            const want = !(heartUri === uri && heartState);
            heartUri = uri;
            heartState = want;
            const api = lib();
            if (api?.add && api?.remove) {
                try { await (want ? api.add({ uris: [uri] }) : api.remove({ uris: [uri] })); } catch {}
            } else {
                sp.toggleHeart?.();
            }
            const lib = uri.startsWith('spotify:episode:') ? 'Your Episodes' : 'Liked Songs';
            toast(want ? `Saved to ${lib}` : `Removed from ${lib}`);
            refreshHeart(uri);
        }

        /* Track */

        let lyricReq = 0;

        async function awaitMeta(item) {
            if (titleOf(item)) return item;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => win.setTimeout(r, 50));
                const now = sp.data?.item;
                if (!now || now.uri !== item.uri) return item;
                if (titleOf(now)) return now;
            }
            return item;
        }

        function showMeta(item) {
            const album = albumOf(item);
            marquee(el.ttlW, el.ttl, titleOf(item) || 'Unknown');
            marquee(el.subW, el.sub, [artistsOf(item), album].filter(Boolean).join(' — ') || '—');
            const small = imgOf(item, 'standard'), big = imgOf(item, 'xlarge');
            if (small && el.art.dataset.src !== small) {
                el.art.dataset.src = small;
                el.art.src = small;
                el.xArt.src = big || small;
                el.xBlur.style.backgroundImage = `url('${small.replace(/'/g, "\\'")}')`;
                setBackground(small);
                setSwirl(small);
                requestPalette(small);
            }
        }

        async function loadTrack(item) {
            curItem = item;
            showMeta(item);
            refreshHeart(item.uri);
            // Only fetched while the expanded view is open.
            loadCanvas(withCanvas() ? item.uri : null);

            // Drop lyrics that arrive after a skip.
            const token = ++lyricReq;
            loadOffset(item.uri);
            currentLyrics = null;
            lyr.active = null;
            el.lyrScroll.innerHTML = '<div class="status"><div class="spinner"></div></div>';
            lyricsLoop();

            const full = await awaitMeta(item);
            if (token !== lyricReq) return;
            if (full !== item) { curItem = full; showMeta(full); }

            // Songs only: ads and podcast episodes have no lyrics to look up.
            const result = /^spotify:(track|local):/.test(full.uri) ? await fetchLyrics(full) : null;
            if (token !== lyricReq) return;
            currentLyrics = result;
            renderLyrics();
            lyr.idx = -1;
            updateLyrics(lyrPos());
            lyricsLoop();
        }

        /* Player state (driven by PlayerAPI events, no polling) */

        function sync(s) {
            s = s || P?.PlayerAPI?.getState?.() || null;
            const item = s?.item || sp.data?.item;
            if (item?.uri && item.uri !== currentTrackUri) { currentTrackUri = item.uri; loadTrack(item); }

            const pl = s ? !s.isPaused : !!sp.isPlaying?.();
            if (pl !== playing) {
                playing = pl;
                el.playIco.innerHTML = pl ? I_PAUSE3 : I_PLAY3;
                el.bPlay.title = el.bPlay.ariaLabel = pl ? 'Pause' : 'Play';
            }
            durMs = Number(s?.duration?.milliseconds) || msOf(item);
            shuffle = s ? (s.shuffle ? (s.smartShuffle ? 2 : 1) : 0) : (sp.getShuffle?.() ? 1 : 0);
            repeat = s?.repeat ?? sp.getRepeat?.() ?? 0;
            limits = s?.restrictions || null;
            paintModes();
            syncProgress();
            if (panel === 'lyrics') updateLyrics(lyrPos());
            lyricsLoop();
        }

        function paintModes() {
            el.qShuf.classList.toggle('on', shuffle > 0);
            el.qShuf.classList.toggle('b', shuffle === 2);
            el.qShuf.title = ['Shuffle', 'Shuffle on', 'Smart shuffle'][shuffle];
            el.qRep.classList.toggle('on', repeat > 0);
            el.qRep.classList.toggle('b', repeat === 2);
            el.qRep.title = ['Repeat', 'Repeat all', 'Repeat one'][repeat] || 'Repeat';
            // Spotify disallows these in autoplay. A class, not disabled, so the tooltip still shows.
            el.qShuf.classList.toggle('off', !!limits && !limits.canToggleShuffle && !limits.canToggleSmartShuffle);
            el.qRep.classList.toggle('off', !!limits && !limits.canToggleRepeatContext && !limits.canToggleRepeatTrack);
            const why = limits?.disallowTogglingShuffleReasons?.includes('autoplay')
                ? 'Not available during autoplay' : 'Not available for this music';
            if (el.qShuf.classList.contains('off')) el.qShuf.title = why;
            if (el.qRep.classList.contains('off'))  el.qRep.title  = why;
        }

        /* Progress: stepped about a pixel at a time (≤4/s), with the times. */

        let tick = null, dragging = false;

        const setFill = p => { el.fill.style.transform = `translateX(${((p - 1) * 100).toFixed(3)}%)`; };

        function syncProgress() {
            win.clearTimeout(tick);
            if (dragging) return;
            const pos = curPos();
            setFill(durMs ? clamp01(pos / durMs) : 0);
            el.tEl.textContent  = fmt(pos);
            el.tRem.textContent = `-${fmtUp(durMs - pos)}`;
            if (playing && durMs) {
                const px = Math.max(1, el.track.clientWidth);
                tick = win.setTimeout(syncProgress, Math.max(250, Math.min(1000, durMs / px)));
            }
        }

        const ratioAt = e => { const r = el.track.getBoundingClientRect(); return clamp01((e.clientX - r.left) / r.width); };
        const scrubTo = p => {
            setFill(p);
            el.tEl.textContent  = fmt(p * durMs);
            el.tRem.textContent = `-${fmtUp(durMs - p * durMs)}`;
        };

        el.bar.onpointerdown = e => {
            if (e.button || !durMs) return;
            dragging = true;
            el.bar.setPointerCapture(e.pointerId);
            el.bar.classList.add('drag');
            win.clearTimeout(tick);
            scrubTo(ratioAt(e));
        };
        el.bar.onpointermove = e => { if (dragging) scrubTo(ratioAt(e)); };
        el.bar.onpointerup = e => {
            if (!dragging) return;
            dragging = false;
            el.bar.classList.remove('drag');
            sp.seek(Math.round(ratioAt(e) * durMs));
            // In case the update event is slow.
            win.setTimeout(syncProgress, 250);
        };
        el.bar.onpointercancel = () => { dragging = false; el.bar.classList.remove('drag'); syncProgress(); };

        /* Transport */

        el.bPlay.onclick = () => sp.togglePlay();

        // Click skips; hold scrubs.
        function holdToScrub(btn, dir, tap) {
            let delay = null, rep = null, held = false;
            const stop = () => { win.clearTimeout(delay); win.clearInterval(rep); delay = rep = null; };
            btn.onpointerdown = e => {
                if (e.button) return;
                held = false;
                btn.setPointerCapture(e.pointerId);
                delay = win.setTimeout(() => {
                    held = true;
                    rep = win.setInterval(() => {
                        sp.seek(Math.round(Math.max(0, Math.min(durMs - 1500, curPos() + dir * 3000))));
                    }, 250);
                }, 420);
            };
            btn.onpointerup = () => { const was = held; stop(); if (!was) tap(); };
            btn.onpointercancel = stop;
            // Keyboard activation.
            btn.onclick = e => { if (e.detail === 0) tap(); };
        }
        holdToScrub(el.bPrev, -1, () => sp.back());
        holdToScrub(el.bNext,  1, () => sp.next());

        /* Shuffle and repeat */

        // Step through the shuffle modes Spotify allows here (off, on, smart).
        async function cycleShuffle() {
            const S = P?.ShuffleAPI, ctx = P?.PlayerAPI?.getState?.()?.context?.uri;
            if (S?.getAvailableShuffleModes && ctx) {
                try {
                    const modes = await S.getAvailableShuffleModes(ctx);
                    const cur = await S.getShuffle(ctx);
                    if (modes.length > 1) await S.setShuffle(ctx, modes[(modes.indexOf(cur) + 1) % modes.length]);
                    return;
                } catch {}
            }
            try { sp.setShuffle?.(!sp.getShuffle?.()); } catch {}
        }
        el.qShuf.onclick = () => { if (!el.qShuf.classList.contains('off')) cycleShuffle(); };
        el.qRep.onclick  = () => { if (!el.qRep.classList.contains('off')) sp.setRepeat?.((repeat + 1) % 3); };

        /* Volume
           The slider moves freely; Spotify is told at most every 250ms and on release
           (each change re-lays-out Spotify's whole window). */

        let volDrag = false, volSent = 0, volTimer = null, volBucket = -1, preMute = 50;

        // Don't reassign the slider mid-drag; Chrome would drop the gesture.
        function showVol(v, fromSlider) {
            if (!fromSlider) el.vol.value = v;
            el.vol.style.setProperty('--v', `${v}%`);
            el.vPct.textContent = v;
            const b = v === 0 ? 0 : v < 34 ? 1 : v < 67 ? 2 : 3;
            // Bar icon: full speaker unless muted. Popover icon shows the level.
            if (b !== volBucket) { volBucket = b; el.vMute.innerHTML = volIcon(v); el.bVol.innerHTML = I_VOL3(b && 3); }
        }

        const pushVol = v => {
            win.clearTimeout(volTimer);
            const wait = 250 - (win.performance.now() - volSent);
            if (wait <= 0) { volSent = win.performance.now(); sp.setVolume(v / 100); }
            else volTimer = win.setTimeout(() => pushVol(v), wait);
        };
        const commitVol = v => { win.clearTimeout(volTimer); volSent = win.performance.now(); sp.setVolume(v / 100); };

        // The popover closes itself shortly after the slider is let go.
        let volClose = null;
        el.vol.oninput = e => {
            win.clearTimeout(volClose);
            volDrag = true;
            const v = +e.target.value;
            showVol(v, true);
            pushVol(v);
        };
        el.vol.onchange = e => {
            commitVol(+e.target.value);
            volDrag = false;
            if (!full) volClose = win.setTimeout(closePops, 700);
        };
        el.vol.onpointerdown = () => win.clearTimeout(volClose);
        el.vMute.onclick = () => {
            const cur = Math.round((sp.getVolume() || 0) * 100);
            const v = cur > 0 ? (preMute = cur, 0) : (preMute || 50);
            showVol(v);
            commitVol(v);
        };

        /* Menus */

        function closePops() {
            const was = body.classList.contains('ov');
            body.classList.remove('ov');
            if (was) { lastWake = -Infinity; wake(); }
            el.scrim.style.display = 'none';
            el.menu.style.display = 'none';
            el.volPop.classList.remove('show');
            el.volPop.style.display = '';
        }

        // Above the anchor if it fits, else below, always inside the window.
        function place(pop, anchor) {
            const a = anchor.getBoundingClientRect(), W = win.innerWidth, H = win.innerHeight;
            pop.style.maxHeight = `${H - 12}px`;
            const r = pop.getBoundingClientRect();
            let top = a.top - r.height - 6;
            if (top < 6) top = Math.min(H - r.height - 6, a.bottom + 6);
            pop.style.top  = `${Math.max(6, top)}px`;
            pop.style.left = `${Math.max(6, Math.min(W - r.width - 6, a.left + a.width / 2 - r.width / 2))}px`;
        }

        function openPop(pop, anchor) {
            win.clearTimeout(idleTimer);
            body.classList.add('ov');
            el.scrim.style.display = 'block';
            if (pop === el.volPop) pop.classList.add('show'); else pop.style.display = 'block';
            place(pop, anchor);
        }

        el.scrim.onpointerdown = closePops;
        el.bVol.onclick = () => {
            showVol(Math.round((sp.getVolume() || 0) * 100));
            openPop(el.volPop, el.bVol);
        };

        let menuItems = [];
        function renderMenu(items, anchor) {
            menuItems = items;
            el.menu.innerHTML = items.map((m, i) => m === '-' ? '<div class="msep"></div>'
                : `<button class="mi" role="menuitem" data-i="${i}"${m.off ? ' disabled' : ''}>${esc(m.t)}${m.sub ? '<span class="chev">›</span>' : ''}</button>`).join('');
            el.menu.scrollTop = 0;
            openPop(el.menu, anchor);
        }
        el.menu.onclick = e => {
            const b = e.target.closest('.mi');
            const m = b && menuItems[+b.dataset.i];
            if (!m) return;
            if (!m.sub) closePops();
            m.f();
        };

        const goTo = uri => {
            const [, type, id] = String(uri || '').split(':');
            if (!type || !id) return;
            try { P.History.push(`/${type}/${id}`); } catch {}
            try { window.focus(); } catch {}
        };

        const SLEEP = [['5 minutes', 1], ['10 minutes', 2], ['15 minutes', 3], ['30 minutes', 4], ['45 minutes', 5], ['1 hour', 6], ['End of track', 7]];
        const hasSleep = () => typeof P?.PlayerAPI?.setSleepTimer === 'function';
        function sleepLabel() {
            const t = P?.PlayerAPI?.getState?.()?.sleepTimer;
            if (t?.type === 2) return 'Sleep timer · end of track';
            const left = t?.type === 1 ? Math.round((Number(t.timestamp) - Date.now()) / 60000) : 0;
            return left > 0 ? `Sleep timer · ${left} min` : 'Sleep timer';
        }
        async function setSleep(v, label) {
            try {
                await P.PlayerAPI.setSleepTimer(v);
                toast(v ? `Sleep timer: ${label.toLowerCase()}` : 'Sleep timer off');
            } catch { toast('Couldn’t set the sleep timer'); }
        }
        function openSleep() {
            const on = (P?.PlayerAPI?.getState?.()?.sleepTimer?.type || 0) !== 0;
            renderMenu([
                { t: '‹ Back', sub: true, f: openMenu },
                '-',
                ...SLEEP.map(([t, v]) => ({ t, f: () => setSleep(v, t) })),
                ...(on ? ['-', { t: 'Turn off', f: () => setSleep(0) }] : []),
            ], el.bDots);
        }

        async function openMenu() {
            const item = curItem;
            await refreshHeart(currentTrackUri);
            const liked = heartUri === currentTrackUri && heartState;
            const [, type, id] = String(currentTrackUri || '').split(':');
            const lib = type === 'episode' ? 'Your Episodes' : 'Liked Songs';
            renderMenu([
                { t: liked ? `Remove from ${lib}` : `Save to ${lib}`, f: toggleHeart, off: !currentTrackUri || type === 'ad' },
                { t: 'Add to Playlist', sub: true, f: openPlaylists, off: !currentTrackUri || item?.isLocal || type === 'ad' },
                '-',
                ...(type === 'episode' ? [{ t: 'Go to Show', f: () => goTo(item?.show?.uri), off: !item?.show?.uri }] : [
                    { t: 'Go to Album',  f: () => goTo(item?.album?.uri),      off: !item?.album?.uri },
                    { t: 'Go to Artist', f: () => goTo(item?.artists?.[0]?.uri), off: !item?.artists?.[0]?.uri },
                ]),
                { t: type === 'episode' ? 'Copy Episode Link' : 'Copy Song Link', off: !id || item?.isLocal || type === 'ad', f: () => {
                    try { P.ClipboardAPI.copy(`https://open.spotify.com/${type}/${id}`); toast('Link copied'); } catch {}
                } },
                ...(hasSleep() ? ['-', { t: sleepLabel(), sub: true, f: openSleep }] : []),
                '-',
                { t: 'Settings', f: () => { panel = 'settings'; layout(); } },
            ], el.bDots);
        }
        el.bDots.onclick = openMenu;

        async function openPlaylists() {
            let lists = [];
            try {
                const root = await P.RootlistAPI.getContents();
                const walk = n => { for (const x of n.items || []) x.type === 'folder' ? walk(x) : lists.push(x); };
                walk(root);
            } catch {}
            lists = lists.filter(l => l.type === 'playlist' && l.canAdd !== false);
            const uri = currentTrackUri;
            renderMenu([
                { t: '‹ Back', sub: true, f: openMenu },
                '-',
                ...(lists.length ? lists.map(l => ({ t: l.name, f: async () => {
                    try {
                        await P.PlaylistAPI.add(l.uri, [uri], { after: 'end' });
                        toast(`Added to ${l.name}`);
                    } catch { toast('Couldn’t add to playlist'); }
                } })) : [{ t: 'No playlists', off: true, f() {} }]),
            ], el.bDots);
        }

        /* Up Next */

        let qItems = { q: [], n: [] };

        async function renderQueue() {
            let q = null;
            try { q = await P.PlayerAPI.getQueue(); } catch {}
            if (panel !== 'queue') return;
            const queued = (q?.queued || []).slice(0, 50);
            const next   = (q?.nextUp || []).slice(0, 50);
            qItems = { q: queued, n: next };
            const row = (t, i, sec) => `<div class="qi" data-sec="${sec}" data-i="${i}">
                <img src="${esc(imgOf(t, 'small'))}" alt="" loading="lazy" draggable="false">
                <div class="qt"><div class="qn">${esc(titleOf(t) || 'Unknown')}</div><div class="qa">${esc(artistsOf(t))}</div></div>
                <span class="qd">${fmt(msOf(t))}</span></div>`;
            el.qList.innerHTML =
                (queued.length ? `<div class="qs">Queue</div>${queued.map((t, i) => row(t, i, 'q')).join('')}` : '') +
                (next.length ? `<div class="qs">Up Next</div>${next.map((t, i) => row(t, i, 'n')).join('')}` : '') ||
                '<div class="status"><div class="msg">Nothing up next</div></div>';
        }
        el.qList.onclick = e => {
            const r = e.target.closest('.qi');
            const t = r && qItems[r.dataset.sec]?.[+r.dataset.i];
            if (t) { try { P.PlayerAPI.skipTo({ uri: t.uri, uid: t.uid }); } catch {} }
        };

        /* Lyrics */

        const lyr = { idx: -1, word: -1, active: null, els: [] };
        let raf = null;

        function renderLyrics() {
            lyr.active = null;
            lyr.els = [];
            if (!currentLyrics?.lines?.length) {
                el.lyrScroll.innerHTML = `<div class="status">${I_NO_LYR}<div class="msg">No lyrics available</div></div>`;
                return;
            }
            const kara = karaoke && currentLyrics.karaoke;
            el.lyrScroll.innerHTML = currentLyrics.lines.map(l => {
                const words = kara && l.words;
                const inner = words ? l.words.map(w => `<span class="w">${esc(w.text)}</span>`).join('') : esc(l.text);
                return `<div class="lyric${words ? ' kara' : ''}" data-t="${l.t}">${inner}</div>`;
            }).join('');
            lyr.els = [...el.lyrScroll.children];
        }

        // Runs only while lyrics are visible and playing.
        function lyricsLoop() {
            const want = panel === 'lyrics' && playing && currentLyrics?.synced && !hidden();
            if (want && raf === null) {
                // Capped near 60fps.
                let last = 0;
                const frame = t => {
                    raf = win.requestAnimationFrame(frame);
                    if (t - last < 15) return;
                    last = t;
                    updateLyrics(lyrPos());
                };
                raf = win.requestAnimationFrame(frame);
            } else if (!want && raf !== null) {
                win.cancelAnimationFrame(raf);
                raf = null;
            }
        }

        function updateLyrics(pos) {
            if (!currentLyrics?.synced || panel !== 'lyrics') return;
            const lines = currentLyrics.lines;
            let ai = -1;
            for (let i = lines.length - 1; i >= 0; i--) { if (pos >= lines[i].t) { ai = i; break; } }

            if (ai !== lyr.idx) {
                const was = lyr.idx;
                lyr.idx = ai;
                lyr.word = -1;
                lyr.active = null;
                // Only update lines whose state changed.
                const lo = Math.max(0, Math.min(was < 0 ? 0 : was, ai));
                const hi = Math.min(lyr.els.length - 1, Math.max(was, ai));
                for (let i = lo; i <= hi; i++) {
                    const line = lyr.els[i];
                    if (!line) continue;
                    if (i === ai) {
                        line.classList.remove('past');
                        line.classList.add('active');
                        lyr.active = line;
                        // Snap instead of a long slow scroll.
                        const wr = el.lyrWrap.getBoundingClientRect(), lr = line.getBoundingClientRect();
                        const off = Math.abs((lr.top + lr.height / 2) - (wr.top + wr.height / 2));
                        line.scrollIntoView({ behavior: off > wr.height * 1.5 ? 'auto' : 'smooth', block: 'center' });
                    } else {
                        line.classList.remove('active');
                        line.classList.toggle('past', i < ai);
                    }
                }
            }

            // Word-by-word fill.
            const words = lyr.active?.classList.contains('kara') ? lines[ai]?.words : null;
            if (!words?.length) return;
            const spans = lyr.active.children;
            let wi = -1;
            for (let i = words.length - 1; i >= 0; i--) { if (pos >= words[i].t) { wi = i; break; } }
            if (wi !== lyr.word) {
                for (let i = 0; i < spans.length; i++) {
                    spans[i].classList.toggle('done', i < wi);
                    if (i > wi) spans[i].style.setProperty('--p', '0%');
                }
                lyr.word = wi;
            }
            if (wi >= 0) {
                const w = words[wi];
                spans[wi]?.style.setProperty('--p', `${(clamp01((pos - w.t) / (w.d || 1)) * 100).toFixed(1)}%`);
            }
        }

        el.lyrScroll.onclick = e => {
            const line = e.target.closest('.lyric');
            if (currentLyrics?.synced && line?.dataset.t != null) sp.seek(Math.max(0, parseInt(line.dataset.t) + lyrOffset));
        };
        const onVis = () => { lyricsLoop(); swirlLoop(); canvasPlay(); };
        visDoc.addEventListener('visibilitychange', onVis);

        /* Settings */

        el.sDone.onclick = () => { panel = null; layout(); };

        el.sizeReset.onclick = () => {
            for (const k of Object.keys(SZ)) SZ[k] = { ...SZ_DEFAULT[k] };
            localStorage.removeItem('wp7-size');
            resize(SZ[view]);
            toast('Window sizes reset');
        };

        el.sBody.addEventListener('click', e => {
            const t = e.target.closest('[data-ah]');
            if (!t) return;
            const k = t.dataset.ah;
            autoHide[k] = !autoHide[k];
            t.classList.toggle('on', autoHide[k]);
            localStorage.setItem(`wp7-ah-${k}`, autoHide[k]);
        });
        el.swSlider.oninput = e => {
            swirlSpeed = parseFloat(e.target.value);
            el.swVal.textContent = swirlSpeed === 0 ? 'Still' : `${swirlSpeed}×`;
            localStorage.setItem('wp7-swirl', swirlSpeed);
        };

        el.togLo.onclick = () => {
            lyricsOnly = !lyricsOnly;
            el.togLo.classList.toggle('on', lyricsOnly);
            localStorage.setItem('wp7-lyrics-only', lyricsOnly);
            layout();
        };

        el.togCanvas.onclick = () => {
            canvasOn = !canvasOn;
            el.togCanvas.classList.toggle('on', canvasOn);
            localStorage.setItem('wp7-canvas', canvasOn);
            loadCanvas(canvasOn && withCanvas() ? currentTrackUri : null);
        };

        el.togCenter.onclick = () => {
            centerLyrics = !centerLyrics;
            el.togCenter.classList.toggle('on', centerLyrics);
            el.lyrScroll.classList.toggle('centered', centerLyrics);
            localStorage.setItem('wp7-center', centerLyrics);
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
            lyr.idx = -1;
        };
        el.mxmTok.onchange = e => {
            mxmToken = e.target.value.trim();
            localStorage.setItem('wp7-mxm', mxmToken);
            lyricCache.clear();
        };

        const PROV_NAMES = { spotify: 'Spotify', lrclib: 'LRCLIB', netease: 'NetEase', musixmatch: 'Musixmatch' };
        function drawProviders() {
            el.provList.innerHTML = provOrder.map((p, i) => `
      <div class="sr prow">
        <span class="num">${i + 1}</span>
        <button class="pup" data-up="${p}" ${i ? '' : 'disabled'} title="Move up">▲</button>
        <span class="slbl">${PROV_NAMES[p]}</span>
        <div class="tog ${provOff.has(p) ? '' : 'on'}" data-prov="${p}"></div>
      </div>`).join('');
        }
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
            lyricCache.clear();
        };
        drawProviders();

        /* Auto-hide */

        let idleTimer = null, lastWake = -Infinity;
        function wake() {
            const up = !body.classList.contains('idle');
            const now = win.performance.now();
            if (up && now - lastWake < 250) return;
            lastWake = now;
            body.classList.remove('idle');
            win.clearTimeout(idleTimer);
            // Up Next and Settings never hide.
            const key = view === 'panel' ? (panel === 'lyrics' ? 'lyrics' : null) : view;
            if (key && (full || autoHide[key]) && !body.classList.contains('ov')) {
                idleTimer = win.setTimeout(() => { remeasure(); body.classList.add('idle'); }, 3200);
            }
        }
        for (const ev of ['mousemove', 'mousedown', 'wheel', 'keydown']) doc.addEventListener(ev, wake, { passive: true });

        // Scroll to change the volume, 5% per notch.
        doc.addEventListener('wheel', e => {
            if (!e.deltaY || e.target.closest?.('#panel, .pop')) return;
            e.preventDefault();
            const v = Math.max(0, Math.min(100, Math.round((+el.vol.value + (e.deltaY < 0 ? 5 : -5)) / 5) * 5));
            showVol(v);
            pushVol(v);
            toast(`Volume ${v}%`);
        }, { passive: false });

        /* Wiring */

        el.wMin.onclick = el.wClose.onclick = closePlayer;
        // Toggles compact/expanded (Spotify's full screen jumps to its lyrics view).
        el.wExp.onclick = () => setMode(view === 'expanded' ? 'compact' : 'expanded');
        el.mini.onclick = () => setMode('compact');
        el.bLyr.onclick  = () => togglePanel('lyrics');
        el.bList.onclick = () => togglePanel('queue');

        doc.addEventListener('keydown', e => {
            if (e.target?.tagName === 'INPUT') return;
            switch (e.key) {
                case ' ': e.preventDefault(); sp.togglePlay(); break;
                case 'ArrowRight': if (durMs) sp.seek(Math.min(durMs, curPos() + 5000)); break;
                case 'ArrowLeft':  sp.seek(Math.max(0, curPos() - 5000)); break;
                case 'ArrowUp':   e.preventDefault(); commitVol(Math.min(100, Math.round((sp.getVolume() || 0) * 100) + 5)); break;
                case 'ArrowDown': e.preventDefault(); commitVol(Math.max(0, Math.round((sp.getVolume() || 0) * 100) - 5)); break;
                case 'l': case 'L': togglePanel('lyrics'); break;
                case 'q': case 'Q': if (!full) togglePanel('queue'); break;
                case '[': if (panel === 'lyrics') nudge(-250); break;
                case ']': if (panel === 'lyrics') nudge(250); break;
                case 'Escape':
                    if (body.classList.contains('ov')) closePops();
                    else if (panel) { panel = null; layout(); }
                    else if (full) closeFull();
                    break;
            }
        });

        // After a resize settles.
        let resizePending = false;
        win.addEventListener('resize', () => {
            if (resizePending) return;
            resizePending = true;
            win.requestAnimationFrame(() => {
                resizePending = false;
                // A drag-resize fires a stream of these; remember the size only after a stream,
                // well clear of our own resizes. A lone one is Chrome snapping the window back to an
                // old size (about 4s after opening), so undo it.
                const now = win.performance.now();
                if (view && !full && now > sizingUntil && now - openedAt > 2500) {
                    burst++;
                    win.clearTimeout(saveTimer);
                    saveTimer = win.setTimeout(() => {
                        if (burst >= 3) {
                            const min = SZ_MIN[view];
                            SZ[view] = { w: Math.max(min.w, win.innerWidth), h: Math.max(min.h, win.innerHeight) };
                            localStorage.setItem('wp7-size', JSON.stringify(SZ));
                        } else if (win.innerWidth !== SZ[view].w || win.innerHeight !== SZ[view].h) resize(SZ[view]);
                        burst = 0;
                    }, 400);
                }
                sizeSwirl();
                remeasure();
                closePops();
                // Re-centre the active line.
                if (panel === 'lyrics') lyr.active?.scrollIntoView({ block: 'center' });
            });
        });

        /* Events */

        const pev = P?.PlayerAPI?.getEvents?.();
        const vev = P?.PlaybackAPI?.getEvents?.();
        const onUpdate = e => sync(e?.data);
        const onQueue  = () => { if (panel === 'queue') renderQueue(); };
        const onVolume = e => { if (!volDrag) showVol(Math.round((e?.data?.volume ?? sp.getVolume() ?? 0) * 100)); };
        const onLib    = () => refreshHeart(currentTrackUri);
        try { pev?.addListener?.('update', onUpdate); pev?.addListener?.('queue_update', onQueue); } catch {}
        try { vev?.addListener?.('volume', onVolume); } catch {}
        // Fallback poll for clients without PlayerAPI events.
        const poll = pev?.addListener ? null : win.setInterval(() => { sync(); if (!volDrag) showVol(Math.round((sp.getVolume() || 0) * 100)); }, 500);
        // Likes made elsewhere (two API shapes exist).
        let unsubLib = null;
        try {
            const ev = lib()?.getEvents?.();
            if (ev?.addListener) {
                ev.addListener(onLib);
                unsubLib = () => { try { ev.removeListener(onLib); } catch {} };
            } else if (ev?.subscribe) {
                const h = ev.subscribe(onLib);
                unsubLib = () => {
                    try {
                        if (typeof h === 'function') h();
                        else if (typeof h?.unsubscribe === 'function') h.unsubscribe();
                        else ev.unsubscribe?.(onLib);
                    } catch {}
                };
            }
        } catch {}

        const tagTimer = scrollFixRuns() ? (tagScanned(), setInterval(tagScanned, 3000)) : null;

        // Unsubscribe from Spotify on close, or old windows stay in memory.
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            visDoc.removeEventListener('visibilitychange', onVis);
            try { pev?.removeListener?.('update', onUpdate); pev?.removeListener?.('queue_update', onQueue); } catch {}
            try { vev?.removeListener?.('volume', onVolume); } catch {}
            unsubLib?.();
            clearInterval(tagTimer);
            win.clearInterval(poll);
            win.clearTimeout(tick);
            if (swirlRaf !== null) win.cancelAnimationFrame(swirlRaf);
            try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
            if (raf !== null) win.cancelAnimationFrame(raf);
            win.clearTimeout(sizeTimer);
            el.xVid.pause();
            el.xVid.removeAttribute('src');
            if (canvasUrl) win.URL.revokeObjectURL(canvasUrl);
            if (full) return;
            try { localStorage.setItem('wp7-pos', JSON.stringify({ x: win.screenX, y: win.screenY })); } catch {}
            if (pipWindow === win) pipWindow = null;
        };
        win.addEventListener('pagehide', cleanup);
        if (full) {
            el.artBox.appendChild(el.xVid);
            el.bPrev.before(el.qShuf);
            el.bNext.after(el.qRep);
            el.bottom.appendChild(el.volPop);
            el.meta.appendChild(el.bDots);
            el.offRow.appendChild(el.lyrOff);
            const fc = doc.createElement('div');
            fc.id = 'fc';
            fc.className = 'chrome';
            fc.innerHTML = `<button class="cb" id="bSet" title="Settings" aria-label="Settings">${I_SET}</button>`;
            fc.prepend(el.bLyr);
            body.appendChild(fc);
            fc.lastChild.onclick = () => togglePanel('settings');
        }

        showVol(Math.round((sp.getVolume() || 0) * 100));
        initSwirl();
        layout();
        sync();

        // requestWindow sometimes opens slightly too big.
        win.setTimeout(() => resize(SZ[view]), 150);
        return cleanup;
    }

    /* Full screen: a frame over Spotify's window. The PiP window closes meanwhile and
       comes back when full screen is closed with ✕ (Esc gives no user gesture to reopen it). */

    let fullFrame = null, fullCleanup = null, reopenPip = false;
    function openFull() {
        if (fullFrame) return;
        reopenPip = !!(pipWindow && !pipWindow.closed);
        if (reopenPip) { pipWindow.close(); pipWindow = null; }
        currentTrackUri = null;
        fullFrame = document.createElement('iframe');
        fullFrame.allow = 'fullscreen';
        fullFrame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:#141417';
        document.body.appendChild(fullFrame);
        fullCleanup = setupPip(fullFrame.contentWindow, true);
        fullFrame.contentWindow.focus();
        fullFrame.requestFullscreen?.().catch(() => {});
    }
    function closeFull() {
        if (!fullFrame) return;
        const frame = fullFrame;
        fullFrame = null;
        fullCleanup?.();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        frame.remove();
        if (reopenPip) { reopenPip = false; openPip(); }
    }
    document.addEventListener('fullscreenchange', () => { if (fullFrame && !document.fullscreenElement) closeFull(); });

    /* Update notice (shown once per new version, in Spotify's window) */

    const NI = {
        design: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 14h16"/>',
        swirl:  '<path d="M12 4a8 8 0 1 1-7.6 5.5"/><path d="M12 8a4 4 0 1 1-3.9 3.1"/>',
        canvas: '<rect x="6" y="3.5" width="12" height="17" rx="2.5"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>',
        list:   '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
        bolt:   '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
        full:   '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
    };
    const I_CHEV = '<svg class="wpnChev" viewBox="0 0 24 24"><path d="M9.3 5.3 16 12l-6.7 6.7-1.4-1.4L13.2 12 7.9 6.7z"/></svg>';

    const WPN_CSS = `
#wpnOverlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    opacity:0;transition:opacity .22s ease;
}
/* Themes often set a font on every element, so set ours on every element too. */
#wpnOverlay,#wpnOverlay *{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif !important;}
#wpnOverlay .wpnHint{font-family:ui-monospace,Consolas,monospace !important;}
#wpnOverlay.in{opacity:1;}
#wpnCard{position:relative;width:min(440px,calc(100vw - 48px));max-height:calc(100vh - 80px);
    display:flex;flex-direction:column;border-radius:20px;overflow:hidden;background:#34494a;color:#fff;text-align:left;
    box-shadow:0 30px 90px rgba(0,0,0,.65),0 0 0 .5px rgba(255,255,255,.14);
    transform:scale(.96) translateY(10px);transition:transform .28s cubic-bezier(.2,.9,.3,1);}
#wpnOverlay.in #wpnCard{transform:none;}

/* Header */
/* Background: soft sage and sea-green shapes drifting behind the whole card,
   darkened further down so the text stays readable. */
.wpnBg{position:absolute;inset:0;overflow:hidden;pointer-events:none;}
.wpnBg::after{content:'';position:absolute;inset:0;
    background:linear-gradient(180deg,rgba(14,22,22,0) 0%,rgba(14,22,22,.3) 35%,rgba(14,22,22,.5) 100%);}
.wpnBlob{position:absolute;border-radius:50%;filter:blur(40px);animation:ease-in-out infinite alternate;}
.wpnBlob.a{width:300px;height:260px;left:-80px;top:-70px;background:#7fa496;animation-name:wpnA;animation-duration:3s;}
.wpnBlob.b{width:280px;height:260px;left:160px;top:-110px;background:#4f8288;animation-name:wpnB;animation-duration:3.7s;}
.wpnBlob.c{width:260px;height:240px;right:-80px;top:180px;background:#9aab9b;opacity:.8;animation-name:wpnC;animation-duration:4.3s;}
.wpnBlob.d{width:240px;height:220px;left:-40px;top:300px;background:#a49c86;opacity:.6;animation-name:wpnD;animation-duration:3.3s;}
.wpnBlob.e{width:280px;height:240px;left:120px;bottom:-90px;background:#5f8f86;opacity:.8;animation-name:wpnB;animation-duration:4s;animation-delay:-1.7s;}
.wpnHero,.wpnBody,.wpnFoot{position:relative;}
.wpnHero{flex:none;padding:26px 26px 22px;}
@keyframes wpnA{to{transform:translate3d(110px,40px,0) scale(1.25);}}
@keyframes wpnB{to{transform:translate3d(-90px,70px,0) scale(.85);}}
@keyframes wpnC{to{transform:translate3d(-120px,-30px,0) scale(1.2);}}
@keyframes wpnD{to{transform:translate3d(90px,-50px,0) scale(1.3);}}
.wpnHeroIn{position:relative;}
.wpnKicker{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.8);}
.wpnBig{display:flex;align-items:baseline;gap:12px;margin-top:6px;}
.wpnVer{font-size:64px;font-weight:800;line-height:1;letter-spacing:-.04em;}
.wpnName{font-size:20px;font-weight:700;letter-spacing:-.01em;}
.wpnSub{font-size:12.5px;color:rgba(255,255,255,.65);margin-top:6px;}
.wpnX{position:absolute;top:14px;right:14px;z-index:2;width:28px;height:28px;border:0;padding:0;border-radius:50%;
    background:rgba(0,0,0,.25);color:rgba(255,255,255,.8);cursor:pointer;display:flex;align-items:center;justify-content:center;
    transition:background .15s,color .15s;}
.wpnX:hover{background:rgba(0,0,0,.45);color:#fff;}
.wpnX svg{width:15px;height:15px;fill:currentColor;}

/* Body */
.wpnBody{flex:1;min-height:0;overflow-y:auto;padding:4px 22px 6px;scrollbar-width:none;}
.wpnBody::-webkit-scrollbar{display:none;}
.wpnLead{font-size:13px;line-height:1.55;color:rgba(255,255,255,.72);margin:0 4px 12px;}
.wpnSum{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;}
.wpnSum li{display:flex;align-items:center;gap:13px;padding:9px 4px;}
.wpnTile{width:36px;height:36px;flex:none;border-radius:10px;display:flex;align-items:center;justify-content:center;
    box-shadow:0 6px 16px rgba(0,0,0,.3),inset 0 0 0 .5px rgba(255,255,255,.25);}
.wpnTile svg{width:19px;height:19px;fill:none;stroke:#fff;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}
.wpnT{font-size:13.5px;font-weight:700;}
.wpnD{font-size:12.5px;line-height:1.4;color:rgba(255,255,255,.62);margin-top:1px;}

/* Full changelog */
.wpnDrop{margin:10px 4px 0;border-top:.5px solid rgba(255,255,255,.1);}
.wpnDrop summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:9px;padding:12px 0;
    font-size:12.5px;font-weight:700;color:rgba(255,255,255,.7);transition:color .15s;}
.wpnDrop summary::-webkit-details-marker{display:none;}
.wpnDrop summary:hover,.wpnDrop[open] summary{color:#fff;}
.wpnChev{width:12px;height:12px;fill:currentColor;transition:transform .2s cubic-bezier(.2,.9,.3,1);}
.wpnDrop[open] .wpnChev{transform:rotate(90deg);}
.wpnRel{padding:0 0 14px;}
.wpnRelHead{display:flex;align-items:baseline;gap:8px;margin:2px 0 6px;}
.wpnRelV{font-size:12px;font-weight:800;padding:2px 8px;border-radius:999px;color:#16201f;
    background:linear-gradient(90deg,#a8c3b6,#7fb0b2);}
.wpnDate{font-size:11px;color:rgba(255,255,255,.4);margin-left:auto;}
.wpnGrp{margin-top:10px;}
.wpnK{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.45);}
.wpnGrp ul{margin:4px 0 0;padding:0 0 0 16px;}
.wpnGrp li{font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.8);margin:2px 0;}

/* Footer */
.wpnFoot{flex:none;display:flex;align-items:center;gap:12px;padding:12px 22px 20px;}
.wpnHint{font-size:11.5px;color:rgba(255,255,255,.4);font-family:ui-monospace,Consolas,monospace;}
.wpnOk{flex:1;cursor:pointer;padding:11px 18px;border:0;border-radius:12px;color:#fff;font-size:13.5px;font-weight:700;
    font-family:inherit;background:linear-gradient(90deg,#6f9a8c,#4f8288 55%,#7f9c96);
    box-shadow:0 8px 22px rgba(79,130,136,.35);transition:transform .12s,filter .15s;}
.wpnOk:hover{filter:brightness(1.1);}
.wpnOk:active{transform:scale(.98);}
@media (prefers-reduced-motion:reduce){#wpnOverlay,#wpnCard,.wpnChev{transition:none}.wpnBlob{animation:none}}`;

    // fresh = first install.
    function showWhatsNew(fresh, from) {
        if (document.getElementById('wpnOverlay')) return;
        if (!document.getElementById('wpnStyle')) {
            const st = document.createElement('style');
            st.id = 'wpnStyle';
            st.textContent = WPN_CSS;
            document.head.appendChild(st);
        }

        const top = CHANGELOG[0];
        const sub = fresh ? 'Thanks for installing' : `${from ? `Updated from ${from}` : 'Updated'} · ${top.date}`;
        const tile = s => `<li><span class="wpnTile" style="background:linear-gradient(135deg,${s.c[0]},${s.c[1]})">
            <svg viewBox="0 0 24 24">${NI[s.i]}</svg></span><div><div class="wpnT">${s.t}</div><div class="wpnD">${s.d}</div></div></li>`;
        const group = n => `<div class="wpnGrp"><div class="wpnK">${n.k}</div>
            <ul>${[].concat(n.v).map(x => `<li>${x}</li>`).join('')}</ul></div>`;
        const release = e => `<div class="wpnRel"><div class="wpnRelHead"><span class="wpnRelV">${e.v}</span>
            <span class="wpnDate">${e.date}</span></div>${e.notes.map(group).join('')}</div>`;

        const ov = document.createElement('div');
        ov.id = 'wpnOverlay';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-label', fresh ? 'Welcome to Wave Player' : 'What’s new in Wave Player');
        ov.innerHTML = `
          <div id="wpnCard">
            <div class="wpnBg"><span class="wpnBlob a"></span><span class="wpnBlob b"></span><span class="wpnBlob c"></span><span class="wpnBlob d"></span><span class="wpnBlob e"></span></div>
            <button class="wpnX" id="wpnX" aria-label="Close">${I_CLOSE}</button>
            <div class="wpnHero">
              <div class="wpnHeroIn">
                <div class="wpnKicker">${fresh ? 'Welcome to' : 'What’s new in'}</div>
                <div class="wpnBig"><span class="wpnVer">${VERSION}</span><span class="wpnName">Wave Player</span></div>
                <div class="wpnSub">${sub}</div>
              </div>
            </div>
            <div class="wpnBody">
              ${fresh ? '<p class="wpnLead">Open it from the miniplayer button in Spotify’s player bar, or the Wave icon in the top bar.</p>' : ''}
              <ul class="wpnSum">${(top.summary || []).map(tile).join('')}</ul>
              <details class="wpnDrop">
                <summary>${I_CHEV}<span>Full changelog</span></summary>
                ${CHANGELOG.map(release).join('')}
              </details>
            </div>
            <div class="wpnFoot">
              ${fresh ? '<span class="wpnHint">Ctrl + Shift + M</span>' : ''}
              <button class="wpnOk" id="wpnOk">Let’s go</button>
            </div>
          </div>`;

        // Listen on the document: Spotify keeps taking focus.
        const close = () => {
            ov.classList.remove('in');
            document.removeEventListener('keydown', onKey, true);
            setTimeout(() => ov.remove(), 260);
        };
        const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(ov);
        ov.querySelector('#wpnX').onclick = close;
        ov.querySelector('#wpnOk').onclick = close;
        // Two frames so the fade-in has a start.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            ov.classList.add('in');
            ov.querySelector('#wpnOk').focus();
        }));
    }

    // Open from the console to preview.
    window.wavePlayerWhatsNew = () => showWhatsNew(false, null);

    function checkVersion() {
        let seen;
        try { seen = localStorage.getItem('wp7-seen-ver'); } catch { return; }
        if (seen === VERSION) return;
        // Save first so a failure can't make it show every launch.
        try { localStorage.setItem('wp7-seen-ver', VERSION); } catch {}
        // Let Spotify's UI finish mounting first.
        setTimeout(() => showWhatsNew(seen === null, seen), 1400);
    }

    /* Launcher: take over Spotify's mini player button (matched several ways). */

    const MINI_SEL = [
        '[data-testid="pip-toggle-button"]',
        '[data-testid*="miniplayer" i]',
        '[data-testid*="pip-toggle" i]',
        '[aria-label*="miniplayer" i]',
        '[aria-label*="mini player" i]',
        '[aria-label*="picture in picture" i]',
        '[aria-label*="picture-in-picture" i]',
    ].join(',');

    const FULL_SEL = '[data-testid="fullscreen-mode-button"]';

    // Newer Spotify acts on pointerdown, so block that too. No preventDefault, or click never fires.
    const blockOthers = e => {
        if (!e.target.closest?.(`${MINI_SEL},${FULL_SEL}`)) return false;
        e.stopPropagation();
        e.stopImmediatePropagation();
        return true;
    };

    document.addEventListener('pointerdown', blockOthers, true);
    document.addEventListener('mousedown', blockOthers, true);
    document.addEventListener('click', e => {
        if (!blockOthers(e)) return;
        e.preventDefault();
        if (e.target.closest(FULL_SEL)) openFull(); else openPip();
    }, true);

    // Other ways in: top-bar button and Ctrl+Shift+M.
    try {
        // Size and colour the icon inline.
        const icon = I_PLAYER.replace('<svg ', '<svg width="16" height="16" fill="currentColor" ');
        const tb = new Spicetify.Topbar.Button('Wave Player', icon, openPip, false);
        // Spicetify's Topbar can't mount on Spotify 1.3, so place the button ourselves.
        setInterval(() => {
            if (tb.element.isConnected) return;
            const group = document.querySelector('[data-testid="user-widget-link"]')?.previousElementSibling;
            const ref = group?.querySelector('button');
            if (!ref) return;
            tb.button.className = ref.className;
            group.prepend(tb.element);
        }, 1000);
    } catch {}
    try { Spicetify.Keyboard?.registerShortcut?.({ key: 'm', ctrl: true, shift: true }, openPip); } catch {}

    // Last, and wrapped, so it can never break the player.
    try { checkVersion(); } catch {}
})();
