// Fake Spotify for the demo page: enough of the Spicetify API to run waveplayer.js unchanged.
// Plays three real songs on a timer (no audio). Covers and the Canvas load from Spotify's CDN;
// lyrics come live from LRCLIB. The player opens into the frame named in data-pip, or with
// data-full, full screen inside this (visible) frame.
(() => {
    const host = window.frameElement;
    const page = window.parent;
    const cfg  = host.dataset;

    const img = id => ['ab67616d00001e02', 'ab67616d00004851', 'ab67616d0000b273', 'ab67616d0000b273']
        .map((p, i) => ({ url: `https://i.scdn.co/image/${p}${id}`, label: ['standard', 'small', 'large', 'xlarge'][i] }));

    const SONGS = [
        { uri: 'spotify:track:3a3dQOO19moXPeTt2PomoT', name: 'What You Heard', artists: ['Sonder'],
          album: ['What You Heard', 'spotify:album:10WCcQKzXZot04kzENu62Z', '9852437d39690c760e108a14'], ms: 238242 },
        { uri: 'spotify:track:4u43I0LP2Xf85OAS85eG0R', name: 'CN TOWER', artists: ['PARTYNEXTDOOR', 'Drake'],
          album: ['$ome $exy $ongs 4 U', 'spotify:album:6Rl6YoCarF2GHPSQmmFjuR', 'b5a28a256eae6dc0424fef59'], ms: 241889,
          canvas: 'https://canvaz.scdn.co/upload/licensor/7MuK3IghCVGmp4a8r3ozJ0/video/ba366cdde9e644168a3757a13313aa8f.cnvs.mp4' },
        { uri: 'spotify:track:5Wdyg2LLFZPPlYUntexViV', name: 'Dawn in the Adan', artists: ['Ichiko Aoba'],
          album: ['Windswept Adan', 'spotify:album:0LxeUCxtPfUtnHTKbW52MB', '4b92776a502f280b488cd3ea'], ms: 285504 },
        { uri: 'spotify:track:3rE5PBReux0vbrIqbWFLnt', name: 'Tuscan Leather', artists: ['Drake'],
          album: ['Nothing Was The Same', 'spotify:album:1XslIirSxfAhhxRdn4Li9t', 'a90d170c61fb7d063d47161d'], ms: 366000 },
    ].map(t => ({
        uri: t.uri, uid: t.uri.split(':').pop(), name: t.name, type: 'track', canvas: t.canvas,
        artists: t.artists.map(name => ({ name, uri: 'spotify:artist:demo' })),
        album: { name: t.album[0], uri: t.album[1], images: img(t.album[2]) },
        duration: { milliseconds: t.ms },
    }));

    // Fake video manifest pointing at the Canvas .mp4 (normal browsers can play it).
    const manifestFor = url => ({
        base_urls: [new URL(url).origin + '/'], initialization_template: new URL(url).pathname.slice(1), segment_template: '',
        contents: [{ start_time_millis: 0, end_time_millis: 0, segment_length: 4,
            profiles: [{ id: 0, mime_type: 'video/webm', video_width: 720, file_type: 'mp4' }] }],
    });

    /* Player state and events */

    let idx = +(cfg.song || 0), playing = true, pos = +(cfg.pos || 42000), since = performance.now();
    let volume = 0.6, shuffle = false, repeat = 0;
    const liked = new Set([SONGS[1].uri]);

    const listeners = {};
    const emitter = name => ({
        addListener: (ev, fn) => { (listeners[`${name}:${ev}`] ||= new Set()).add(fn); },
        removeListener: (ev, fn) => { listeners[`${name}:${ev}`]?.delete(fn); },
    });
    const emit = (name, ev, data) => listeners[`${name}:${ev}`]?.forEach(fn => { try { fn({ data }); } catch {} });

    const progress = () => playing ? pos + (performance.now() - since) : pos;
    const song = () => SONGS[idx];
    const state = () => ({
        item: song(), isPaused: !playing, shuffle, smartShuffle: false, repeat, speed: 1,
        duration: song().duration, positionAsOfTimestamp: progress(), timestamp: Date.now(),
        context: { uri: 'spotify:album:demo' },
        restrictions: { canToggleShuffle: true, canToggleSmartShuffle: false, canToggleRepeatContext: true, canToggleRepeatTrack: true },
    });
    const update = () => emit('player', 'update', state());
    const setPos = ms => { pos = Math.max(0, Math.min(song().duration.milliseconds, ms)); since = performance.now(); update(); };
    const go = i => { idx = (i + SONGS.length) % SONGS.length; pos = 0; since = performance.now(); update(); emit('player', 'queue_update', {}); };
    const queue = () => ({ queued: [], nextUp: [1, 2].map(k => SONGS[(idx + k) % SONGS.length]) });

    // Next song when one ends.
    setInterval(() => { if (progress() >= song().duration.milliseconds) repeat === 2 ? setPos(0) : go(idx + 1); }, 500);

    let openPlayer = null;

    window.Spicetify = {
        Player: {
            get data() { return { item: song() }; },
            getProgress: progress,
            getDuration: () => song().duration.milliseconds,
            isPlaying: () => playing,
            play: () => { if (!playing) { since = performance.now(); playing = true; update(); } },
            pause: () => { if (playing) { pos = progress(); playing = false; update(); } },
            togglePlay: () => playing ? Spicetify.Player.pause() : Spicetify.Player.play(),
            next: () => go(idx + 1),
            back: () => progress() > 3000 ? setPos(0) : go(idx - 1),
            seek: ms => setPos(ms),
            getVolume: () => volume,
            setVolume: v => { volume = v; emit('playback', 'volume', { volume: v }); },
            getShuffle: () => shuffle,
            setShuffle: v => { shuffle = !!v; update(); },
            toggleShuffle: () => { shuffle = !shuffle; update(); },
            getRepeat: () => repeat,
            setRepeat: v => { repeat = v; update(); },
            getHeart: () => liked.has(song().uri),
            toggleHeart: () => { liked.has(song().uri) ? liked.delete(song().uri) : liked.add(song().uri); },
            addEventListener() {},
        },
        Platform: {
            version: '1.2.60',
            PlayerAPI: {
                getState: state,
                getEvents: () => emitter('player'),
                getQueue: async () => queue(),
                skipTo: ({ uri }) => go(SONGS.findIndex(s => s.uri === uri)),
            },
            PlaybackAPI: { getEvents: () => emitter('playback') },
            LibraryAPI: {
                contains: async uri => [liked.has(uri)],
                add: async ({ uris }) => uris.forEach(u => liked.add(u)),
                remove: async ({ uris }) => uris.forEach(u => liked.delete(u)),
                getEvents: () => ({ addListener() {}, removeListener() {} }),
            },
            RootlistAPI: { getContents: async () => ({ items: ['Late Drives', 'Rainy Mornings', 'Favourites'].map((name, i) => ({ type: 'playlist', name, uri: `spotify:playlist:demo${i}`, canAdd: true })) }) },
            PlaylistAPI: { add: async () => {} },
            ClipboardAPI: { copy: async () => {} },
            History: { push() {} },
        },
        // No Spotify session: its lyrics fail, so the player falls through to LRCLIB.
        // Cosmos only answers the Canvas manifest.
        CosmosAsync: { get: async url => {
            const t = /\/manifests\//.test(url) && SONGS.find(x => x.canvas && url.includes(x.uid));
            if (t) return manifestFor(t.canvas);
            throw new Error('demo');
        } },
        GraphQL: {
            Definitions: { canvas: { name: 'canvas' } },
            Request: async (def, vars) => {
                const t = SONGS.find(x => x.uri === vars?.trackUri);
                return { data: { trackUnion: { canvas: t?.canvas ? { type: 'VIDEO_LOOPING', fileId: t.uid, url: t.canvas } : null } } };
            },
        },
        Topbar: { Button: function (label, icon, onClick) { openPlayer = onClick; this.element = document.createElement('div'); this.button = document.createElement('button'); } },
        Keyboard: { registerShortcut() {} },
        showNotification() {},
    };

    // The "PiP window" is a visible frame; resizeBy resizes it. defineProperty because
    // browsers with the real API don't allow plain assignment.
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: {
        window: null,
        requestWindow: async () => {
            const f = page.document.getElementById(cfg.pip), w = f.contentWindow;
            w.resizeBy = (dw, dh) => {
                f.style.width  = `${f.offsetWidth + dw}px`;
                f.style.height = `${f.offsetHeight + dh}px`;
            };
            w.moveBy = () => {};
            return w;
        },
    } });

    // Starting view for this frame, and skip the update screen.
    localStorage.setItem('wp7-mode', cfg.mode === 'expanded' ? 'expanded' : 'compact');
    localStorage.setItem('wp7-seen-ver', 'v3');

    // The player's window, once open.
    const playerWin = () => cfg.full ? document.querySelector('iframe')?.contentWindow : page.document.getElementById(cfg.pip).contentWindow;

    // Full screen opens from Spotify's full screen button.
    const fsButton = document.createElement('button');
    fsButton.dataset.testid = 'fullscreen-mode-button';
    document.body.appendChild(fsButton);

    function open() {
        if (cfg.full) fsButton.click(); else openPlayer();
        setTimeout(() => {
            const w = playerWin();
            if (cfg.panel) w.document.getElementById(cfg.panel === 'lyrics' ? 'bLyr' : 'bList')?.click();
            // Let the page scroll over the player (it would change the volume).
            w.addEventListener('wheel', e => e.stopImmediatePropagation(), true);
        }, 400);
    }

    // Open the player once it's ready.
    const start = setInterval(() => {
        if (!openPlayer) return;
        clearInterval(start);
        open();
        host.dispatchEvent(new Event('opened'));
    }, 50);

    // Closing full screen (✕ or Esc) would leave an empty frame; open it again.
    if (cfg.full) new MutationObserver(ms => { if (ms.some(m => [...m.removedNodes].some(n => n.tagName === 'IFRAME'))) open(); })
        .observe(document.body, { childList: true });
})();
