// WavePlayer v8 — "Liquid Glass" · Apple Music Mini Player for Spicetify
// 3 modes: compact bar | expanded player | lyrics (full-screen)
// v8: vibrant-glass redesign — drifting ambient art background, frosted
//     glass materials, glyph transport, knobless Apple scrubber, blurred
//     lyric lines, marquee titles, repeat-one badge, keyboard shortcuts.

(async function WavePlayer() {
    while (!Spicetify?.Player?.data || !Spicetify?.Platform || !Spicetify?.CosmosAsync) {
        await new Promise(r => setTimeout(r, 100));
    }

    // ─────────────────────────────────────────────
    //  CONFIG
    // ─────────────────────────────────────────────
    const SZ = {
        compact:  { w: 460, h: 80  },
        expanded: { w: 390, h: 546 },
        lyrics:   { w: 390, h: 640 },
    };

    // ─────────────────────────────────────────────
    //  PERSISTED SETTINGS
    // ─────────────────────────────────────────────
    let mode         = localStorage.getItem('wp7-mode')   || 'expanded';
    let centerLyrics = localStorage.getItem('wp7-center') !== 'false';
    let showVol      = localStorage.getItem('wp7-vol')    !== 'false';
    let fontSize     = parseInt(localStorage.getItem('wp7-fs') || '22');

    // ─────────────────────────────────────────────
    //  RUNTIME
    // ─────────────────────────────────────────────
    let pipWindow       = null;
    let currentLyrics   = null;
    let currentTrackUri = null;
    let lastDuration    = 0;
    let rafId           = null;
    const prev = { pct: -1, dur: -1, playing: null, heart: null,
                   shuffle: null, repeat: null, vol: -1, idx: -1, _el: 0 };

    // ─────────────────────────────────────────────
    //  COLOR EXTRACTION  (k-means)
    // ─────────────────────────────────────────────
    function clampC(n) { return Math.max(0, Math.min(255, Math.round(n))); }

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
        // Keep accent readable: lift very dark accents toward pastel
        const aLum = (0.2126*acc.r + 0.7152*acc.g + 0.0722*acc.b)/255;
        if (aLum < 0.22) acc = { r: clampC(acc.r + (255-acc.r)*0.35), g: clampC(acc.g + (255-acc.g)*0.35), b: clampC(acc.b + (255-acc.b)*0.35) };
        return { dom, acc };
    }

    const colorCache = new Map();
    async function getColors(url) {
        if (!url) return null;
        if (colorCache.has(url)) return colorCache.get(url);
        return new Promise(res => {
            const img = new Image();
            img.crossOrigin='anonymous'; img.referrerPolicy='no-referrer';
            img.onload = () => {
                try {
                    const cv=document.createElement('canvas'); cv.width=cv.height=64;
                    const ctx=cv.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0,64,64);
                    const p=buildPalette(ctx.getImageData(0,0,64,64).data,64,64);
                    if(colorCache.size>60) colorCache.clear();
                    colorCache.set(url,p); res(p);
                } catch { res(null); }
            };
            img.onerror=()=>res(null); img.src=url;
        });
    }

    // ─────────────────────────────────────────────
    //  LYRICS FETCH
    // ─────────────────────────────────────────────
    async function fetchLyrics(uri) {
        const id = uri.split(':').pop();
        for (const fn of [
            ()=>Spicetify.CosmosAsync.get(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&market=from_token`),
            ()=>Spicetify.CosmosAsync.get(`wg://lyrics/v1/track/${id}?format=json&market=from_token`),
        ]) {
            try {
                const r = await fn();
                const lines = r?.lyrics?.lines || r?.lines;
                if (lines?.length) return {
                    synced: r?.lyrics?.syncType==='LINE_SYNCED'||!!r?.lines,
                    lines: lines.map(l=>({t:parseInt(l.startTimeMs||l.time||0),text:l.words||l.text||''})).filter(l=>l.text.trim()),
                };
            } catch {}
        }
        if (Spicetify.Platform?.Lyrics) {
            try {
                const r = await Spicetify.Platform.Lyrics.getLyrics(uri);
                if (r?.lines?.length) return { synced:true, lines:r.lines.map(l=>({t:l.startTimeMs||0,text:l.words||l.text||''})).filter(l=>l.text.trim()) };
            } catch {}
        }
        return null;
    }

    // ─────────────────────────────────────────────
    //  UTILS
    // ─────────────────────────────────────────────
    const esc = s => { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; };
    const fmt = ms => { if(!ms||!isFinite(ms)||ms<0) return '0:00'; const s=Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
    const H_FILL = '<path d="M15.724 4.22A4.313 4.313 0 0 0 12.192.814a4.269 4.269 0 0 0-3.622 1.13.837.837 0 0 1-1.14 0 4.272 4.272 0 0 0-6.21 5.855l5.916 7.05a1.128 1.128 0 0 0 1.727 0l5.916-7.05a4.228 4.228 0 0 0 .945-3.577z"/>';
    const H_LINE = '<path d="M1.69 2A4.582 4.582 0 0 1 8 2.023 4.583 4.583 0 0 1 11.88.817h.002a4.618 4.618 0 0 1 3.782 3.65v.003a4.543 4.543 0 0 1-1.011 3.84L9.35 14.629a1.765 1.765 0 0 1-2.093.464 1.762 1.762 0 0 1-.605-.463L1.348 8.309A4.582 4.582 0 0 1 1.689 2zm3.158.252A3.082 3.082 0 0 0 2.49 7.337l.005.005L7.8 13.664a.264.264 0 0 0 .311.069.262.262 0 0 0 .09-.069l5.312-6.33a3.043 3.043 0 0 0 .68-2.573 3.118 3.118 0 0 0-2.551-2.463 3.079 3.079 0 0 0-2.612.816l-.007.007a1.501 1.501 0 0 1-2.045 0l-.009-.008a3.082 3.082 0 0 0-2.121-.861z"/>';
    function vIco(v) {
        if(v===0) return `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.86 5.47a.75.75 0 0 0-1.061 0l-1.47 1.47-1.47-1.47A.75.75 0 0 0 8.8 6.53L10.269 8l-1.47 1.47a.75.75 0 1 0 1.06 1.06l1.47-1.47 1.47 1.47a.75.75 0 0 0 1.06-1.06L12.39 8l1.47-1.47a.75.75 0 0 0 0-1.06z"/><path d="M10.116 1.5A.75.75 0 0 0 8.991.85l-6.925 4a3.642 3.642 0 0 0-1.33 4.967 3.639 3.639 0 0 0 1.33 1.332l6.925 4a.75.75 0 0 0 1.125-.649v-1.906a4.73 4.73 0 0 1-1.5-.694v1.3L2.817 9.852a2.141 2.141 0 0 1-.781-2.92c.187-.324.456-.594.78-.782l5.8-3.35v1.3c.45-.313.956-.55 1.5-.694V1.5z"/></svg>`;
        if(v<50) return `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4a3.642 3.642 0 0 1-1.33-4.967 3.639 3.639 0 0 1 1.33-1.332l6.925-4a.75.75 0 0 1 .75 0zm-6.924 5.3a2.139 2.139 0 0 0 0 3.7l5.8 3.35V2.8l-5.8 3.35zm8.683 4.29V5.56a2.75 2.75 0 0 1 0 4.88z"/></svg>`;
        return `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4a3.642 3.642 0 0 1-1.33-4.967 3.639 3.639 0 0 1 1.33-1.332l6.925-4a.75.75 0 0 1 .75 0zm-6.924 5.3a2.139 2.139 0 0 0 0 3.7l5.8 3.35V2.8l-5.8 3.35zm8.683 6.087a4.502 4.502 0 0 0 0-8.474v1.65a2.999 2.999 0 0 1 0 5.175v1.649z"/></svg>`;
    }
    // Subtle film grain (tiny SVG noise tile)
    const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

    // ─────────────────────────────────────────────
    //  CSS  — Liquid Glass design system
    // ─────────────────────────────────────────────
    const CSS = `
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html{height:100%}
    body{
        font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI Variable Display','Segoe UI','Helvetica Neue',sans-serif;
        color:#fff;background:#0a0a0c;height:100%;overflow:hidden;
        -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
        --accent:#fc3c44;--accent-glow:rgba(252,60,68,.32);--heart:#ff5c5c;
        --glass:rgba(255,255,255,.07);--glass-hi:rgba(255,255,255,.13);
        --hairline:rgba(255,255,255,.12);
        --txt-2:rgba(255,255,255,.55);--txt-3:rgba(255,255,255,.38);
        box-shadow:inset 0 0 0 .5px rgba(255,255,255,.14),inset 0 .5px 0 rgba(255,255,255,.18);
        animation:bodyIn .35s ease;
    }
    @keyframes bodyIn{from{opacity:0}to{opacity:1}}

    /* ── Ambient background: drifting blurred art, crossfaded ── */
    #bgWrap{position:fixed;inset:0;z-index:0;overflow:hidden;}
    .bgl{position:absolute;inset:-90px;background-size:cover;background-position:center;
        filter:blur(72px) saturate(1.95) brightness(.46);opacity:0;
        transition:opacity 1.2s ease;will-change:opacity,transform;
        animation:drift 44s ease-in-out infinite alternate;}
    .bgl.show{opacity:1;}
    #bgB{animation-delay:-22s;}
    @keyframes drift{
        0%{transform:scale(1.16) rotate(0deg)}
        100%{transform:scale(1.34) rotate(5deg)}
    }
    @media (prefers-reduced-motion:reduce){.bgl{animation:none;transform:scale(1.2)}}
    #ov{position:fixed;inset:0;z-index:1;pointer-events:none;
        background:
            radial-gradient(120% 90% at 50% -10%,rgba(255,255,255,.07),transparent 55%),
            linear-gradient(180deg,rgba(0,0,0,.10) 0%,rgba(0,0,0,.34) 55%,rgba(0,0,0,.62) 100%);}
    #grain{position:fixed;inset:0;z-index:2;pointer-events:none;opacity:.05;
        background-image:${GRAIN};background-size:160px 160px;mix-blend-mode:overlay;}

    #root{position:relative;z-index:10;height:100%;display:flex;flex-direction:column;overflow:hidden;}

    /* ── Marquee titles ── */
    .mqwrap{overflow:hidden;white-space:nowrap;max-width:100%;
        -webkit-mask-image:linear-gradient(90deg,#000 0,#000 92%,transparent);
        mask-image:linear-gradient(90deg,#000 0,#000 92%,transparent);}
    .mq{display:inline-block;white-space:nowrap;will-change:transform;}
    .mq.scroll{animation:mq var(--mqd,9s) linear 2.2s infinite alternate;}
    @keyframes mq{from{transform:translateX(0)}to{transform:translateX(var(--mqx,0))}}
    @media (prefers-reduced-motion:reduce){.mq.scroll{animation:none}}

    /* ═════════════════════════════
       COMPACT BAR
    ═════════════════════════════ */
    #compact{
        display:flex;align-items:center;height:100%;padding:0 12px 0 12px;gap:11px;
        -webkit-app-region:drag;app-region:drag;overflow:hidden;
    }
    #compact *{-webkit-app-region:no-drag;app-region:no-drag;}
    .ca{width:56px;height:56px;flex-shrink:0;border-radius:11px;object-fit:cover;
        box-shadow:0 6px 18px rgba(0,0,0,.55),0 0 0 .5px rgba(255,255,255,.12);
        transition:transform .45s cubic-bezier(.34,1.56,.64,1);}
    .ca.paused{transform:scale(.88);}
    .ci{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px;}
    .ct{font-size:13px;font-weight:700;letter-spacing:-.015em;line-height:1.25;}
    .cr{font-size:11px;color:var(--txt-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cp{height:10px;display:flex;align-items:center;margin-top:4px;cursor:pointer;position:relative;}
    .cpt{height:3px;flex:1;background:rgba(255,255,255,.18);border-radius:3px;overflow:hidden;
        transition:height .18s ease;}
    .cp:hover .cpt{height:5px;}
    .cpf{height:100%;background:rgba(255,255,255,.92);border-radius:3px;}
    .cbtns{display:flex;align-items:center;gap:3px;flex-shrink:0;}
    /* transport lives in a floating glass capsule */
    .cpill{display:flex;align-items:center;gap:1px;padding:3px;border-radius:999px;
        position:relative;margin-right:7px;
        background:rgba(255,255,255,.07);
        backdrop-filter:blur(24px) saturate(1.6);-webkit-backdrop-filter:blur(24px) saturate(1.6);
        box-shadow:inset 0 0 0 .5px rgba(255,255,255,.09);}
    .cb{background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
        border-radius:50%;width:32px;height:32px;color:rgba(255,255,255,.82);
        transition:color .14s,background .14s,transform .12s cubic-bezier(.34,1.56,.64,1);}
    .cb:hover{color:#fff;background:var(--glass);}
    .cb:active{transform:scale(.82);}
    .cb svg{fill:currentColor;width:15px;height:15px;display:block;}
    .cb.cplay{width:36px;height:36px;color:#fff;background:var(--glass-hi);
        box-shadow:inset 0 0 0 .5px rgba(255,255,255,.1),inset 0 .5px 0 rgba(255,255,255,.16);}
    .cb.cplay svg{width:18px;height:18px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45));}
    .cb.cplay:hover{background:rgba(255,255,255,.2);}
    .cb.csec{width:30px;height:30px;border-radius:10px;color:rgba(255,255,255,.5);}
    .cb.csec:hover{color:#fff;}
    .cb.hon{color:var(--heart) !important;}

    /* ═════════════════════════════
       SHARED: drag handle
    ═════════════════════════════ */
    .dh{height:26px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
        cursor:grab;-webkit-app-region:drag;app-region:drag;}
    .dh:active{cursor:grabbing;}
    .dp{width:36px;height:4.5px;border-radius:3px;background:rgba(255,255,255,.22);
        box-shadow:0 .5px 0 rgba(255,255,255,.1) inset;}

    /* ═════════════════════════════
       EXPANDED MODE
    ═════════════════════════════ */
    #expanded{display:flex;flex-direction:column;height:100%;overflow:hidden;}

    /* Art — flexes so the layout always fits */
    #artSec{flex:1 1 auto;min-height:0;padding:2px 28px 12px;
        display:flex;align-items:center;justify-content:center;
        -webkit-app-region:drag;app-region:drag;}
    .af{position:relative;aspect-ratio:1;height:100%;max-width:100%;max-height:334px;}
    #artImg{width:100%;height:100%;object-fit:cover;border-radius:18px;display:block;
        -webkit-app-region:no-drag;app-region:no-drag;will-change:transform,box-shadow;
        transition:transform .55s cubic-bezier(.34,1.56,.64,1),box-shadow .55s ease;}
    #artImg.playing{transform:scale(1);
        box-shadow:0 30px 72px rgba(0,0,0,.74),0 12px 30px rgba(0,0,0,.52),
                   0 0 64px var(--accent-glow),0 0 0 .5px rgba(255,255,255,.14),
                   inset 0 0 0 .5px rgba(255,255,255,.1);}
    #artImg.paused{transform:scale(.9);
        box-shadow:0 12px 34px rgba(0,0,0,.5),0 0 0 .5px rgba(255,255,255,.08);}

    /* Info */
    #infoSec{flex:0 0 auto;padding:0 24px 2px;-webkit-app-region:no-drag;app-region:no-drag;}
    .ir{display:flex;align-items:center;gap:10px;}
    .it{flex:1;min-width:0;}
    .etitle{font-size:18px;font-weight:700;letter-spacing:-.022em;line-height:1.22;}
    .eartist{font-size:14px;font-weight:500;color:var(--txt-2);letter-spacing:-.01em;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}
    .hb{background:none;border:none;cursor:pointer;flex-shrink:0;width:38px;height:38px;
        border-radius:12px;display:flex;align-items:center;justify-content:center;
        color:rgba(255,255,255,.45);
        transition:color .15s,background .15s,transform .15s cubic-bezier(.34,1.56,.64,1);}
    .hb:hover{color:#fff;background:var(--glass);}
    .hb:active{transform:scale(.8);}
    .hb svg{fill:currentColor;width:20px;height:20px;display:block;}
    .hb.liked{color:var(--heart);}

    /* ── Unified floating glass control card ── */
    #ctrlCard{
        flex:0 0 auto;margin:6px 12px 12px;padding:10px 16px 8px;position:relative;
        background:rgba(18,18,22,.36);border-radius:24px;
        backdrop-filter:blur(40px) saturate(1.7);-webkit-backdrop-filter:blur(40px) saturate(1.7);
        box-shadow:0 18px 44px rgba(0,0,0,.48),0 2px 10px rgba(0,0,0,.28),
                   inset 0 0 0 .5px rgba(255,255,255,.05);
        -webkit-app-region:no-drag;app-region:no-drag;
    }

    /* Scrubber — Apple style: knobless bar that grows on hover */
    #progSec{flex:0 0 auto;padding:2px 8px 0;-webkit-app-region:no-drag;app-region:no-drag;}
    .pw{position:relative;height:18px;cursor:pointer;display:flex;align-items:center;}
    .pt{flex:1;height:5px;background:rgba(255,255,255,.2);border-radius:4px;overflow:hidden;
        transition:height .2s ease,background .2s ease;}
    .pw:hover .pt,.pw:active .pt{height:8px;background:rgba(255,255,255,.26);}
    .pf{height:100%;background:rgba(255,255,255,.9);border-radius:4px;}
    .times{display:flex;justify-content:space-between;margin-top:5px;}
    .tm{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--txt-3);
        font-variant-numeric:tabular-nums;transition:color .2s;}
    .pw:hover ~ .times .tm{color:var(--txt-2);}

    /* Transport — Apple glyph style */
    #ctrlSec{flex:0 0 auto;padding:0 8px;-webkit-app-region:no-drag;app-region:no-drag;}
    .ctrlrow{display:flex;align-items:center;justify-content:space-between;}
    .eb{background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
        border-radius:13px;color:rgba(255,255,255,.92);position:relative;
        transition:color .14s,background .14s,transform .13s cubic-bezier(.34,1.56,.64,1);}
    .eb:hover{background:var(--glass);}
    .eb:active{transform:scale(.8);}
    .eb svg{fill:currentColor;display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,.35));}
    .eb.sm{width:40px;height:40px;color:rgba(255,255,255,.6);} .eb.sm svg{width:17px;height:17px;}
    .eb.sm:hover{color:#fff;}
    .eb.md{width:50px;height:50px;} .eb.md svg{width:26px;height:26px;}
    .eb.on{color:var(--accent) !important;}
    .eplay{width:62px !important;height:62px !important;}
    .eplay svg{width:34px !important;height:34px !important;
        filter:drop-shadow(0 3px 9px rgba(0,0,0,.5)) !important;}
    .eplay:active{transform:scale(.78) !important;}
    .rbadge{position:absolute;top:5px;right:5px;width:12px;height:12px;border-radius:50%;
        background:var(--accent);color:#000;font-size:8px;font-weight:800;line-height:12px;
        text-align:center;display:none;box-shadow:0 1px 4px rgba(0,0,0,.4);}
    .eb.r1 .rbadge,.lb.r1 .rbadge{display:block;}

    /* Volume — Apple style filled slider */
    #volSec{flex:0 0 auto;padding:2px 8px 6px;display:flex;align-items:center;gap:11px;
        -webkit-app-region:no-drag;app-region:no-drag;}
    .vb{background:none;border:none;cursor:pointer;color:var(--txt-3);
        width:20px;height:20px;display:flex;align-items:center;justify-content:center;
        transition:color .14s;flex-shrink:0;}
    .vb:hover{color:rgba(255,255,255,.85);}
    .vb svg{width:14px;height:14px;}
    .vs{-webkit-appearance:none;appearance:none;flex:1;height:5px;border-radius:4px;
        background:linear-gradient(90deg,rgba(255,255,255,.9) 0%,rgba(255,255,255,.16) 0%);
        outline:none;cursor:pointer;transition:height .18s ease;}
    .vs:hover{height:8px;}
    .vs::-webkit-slider-thumb{-webkit-appearance:none;width:0;height:0;}
    .vs:hover::-webkit-slider-thumb{width:14px;height:14px;border-radius:50%;background:#fff;
        box-shadow:0 1px 6px rgba(0,0,0,.45);cursor:pointer;}

    /* Footer — bottom row inside the control card */
    #expFooter{
        flex:0 0 auto;margin-top:4px;padding:4px 2px 0;
        display:flex;align-items:center;justify-content:space-between;
        border-top:1px solid rgba(255,255,255,.06);
        -webkit-app-region:no-drag;app-region:no-drag;
    }
    .foot-btn{background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:7px;
        color:var(--txt-2);font-size:11px;font-weight:700;text-transform:uppercase;
        letter-spacing:.12em;padding:7px 11px;border-radius:11px;
        transition:color .15s,background .15s;}
    .foot-btn:hover{color:#fff;background:var(--glass-hi);}
    .foot-btn svg{fill:currentColor;width:14px;height:14px;flex-shrink:0;}
    .foot-icon{background:none;border:none;cursor:pointer;width:30px;height:30px;
        display:flex;align-items:center;justify-content:center;border-radius:10px;
        color:var(--txt-3);transition:color .15s,background .15s;}
    .foot-icon:hover{color:#fff;background:var(--glass-hi);}
    .foot-icon svg{fill:currentColor;width:14px;height:14px;}

    /* ═════════════════════════════
       LYRICS MODE
    ═════════════════════════════ */
    #lyrMode{display:flex;flex-direction:column;height:100%;overflow:hidden;}

    #lyrHeader{
        flex:0 0 auto;margin:8px 12px 2px;padding:9px 14px;
        display:flex;align-items:center;gap:11px;position:relative;
        background:rgba(18,18,22,.32);border-radius:20px;
        backdrop-filter:blur(36px) saturate(1.7);-webkit-backdrop-filter:blur(36px) saturate(1.7);
        box-shadow:0 10px 30px rgba(0,0,0,.32),inset 0 0 0 .5px rgba(255,255,255,.05);
        -webkit-app-region:drag;app-region:drag;
    }
    /* soft light-catch sheen — fades at the corners instead of a hard ruler line */
    #lyrHeader::before,#lyrCtrl::before,#ctrlCard::before{
        content:'';position:absolute;top:0;left:16%;right:16%;height:1px;
        border-radius:1px;pointer-events:none;
        background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);
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
    .lyrh-btn{background:none;border:none;cursor:pointer;width:32px;height:32px;
        border-radius:10px;display:flex;align-items:center;justify-content:center;
        color:rgba(255,255,255,.45);transition:color .15s,background .15s,transform .13s;}
    .lyrh-btn:hover{color:#fff;background:var(--glass);}
    .lyrh-btn:active{transform:scale(.84);}
    .lyrh-btn svg{fill:currentColor;width:16px;height:16px;display:block;}
    .lyrh-btn.liked{color:var(--heart);}

    /* Lyrics scroll area */
    /* lyrics dissolve into transparency at top/bottom — no dark band, no hard line */
    #lyrWrap{flex:1;min-height:0;position:relative;overflow:hidden;
        -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 60px,#000 calc(100% - 76px),transparent 100%);
        mask-image:linear-gradient(to bottom,transparent 0,#000 60px,#000 calc(100% - 76px),transparent 100%);}
    .lyr-fade-t,.lyr-fade-b{display:none;}
    #lyrScroll{height:100%;overflow-y:auto;padding:30px 24px 90px;scrollbar-width:none;}
    #lyrScroll::-webkit-scrollbar{display:none;}
    #lyrScroll.centered .lyric{text-align:center;transform-origin:center center;}

    /* Lyric lines — Apple Music style: bold, inactive lines softly blurred */
    .lyric{
        font-size:var(--lsz,22px);font-weight:800;letter-spacing:-.022em;
        line-height:1.26;color:rgba(255,255,255,.30);
        padding:7px 0;cursor:pointer;user-select:none;
        transform-origin:left center;transform:scale(.97);
        filter:blur(1.3px);will-change:transform,filter,color;
        transition:color .4s cubic-bezier(.4,0,.2,1),
                   filter .4s cubic-bezier(.4,0,.2,1),
                   transform .4s cubic-bezier(.34,1.2,.4,1);
    }
    .lyric:hover{color:rgba(255,255,255,.62) !important;filter:blur(0) !important;}
    .lyric.past{color:rgba(255,255,255,.42);filter:blur(.7px);}
    .lyric.active{
        color:#fff;transform:scale(1.03);filter:blur(0);
        text-shadow:0 0 34px rgba(255,255,255,.16),0 0 64px var(--accent-glow);
    }
    @media (prefers-reduced-motion:reduce){.lyric{transition:color .3s;transform:none !important}}

    /* ── Lyrics bottom panel — floating glass card ── */
    #lyrCtrl{
        flex:0 0 auto;margin:0 12px 12px;padding:12px 18px 14px;position:relative;
        background:rgba(18,18,22,.38);border-radius:24px;
        backdrop-filter:blur(40px) saturate(1.7);-webkit-backdrop-filter:blur(40px) saturate(1.7);
        box-shadow:0 18px 44px rgba(0,0,0,.5),0 2px 10px rgba(0,0,0,.28),
                   inset 0 0 0 .5px rgba(255,255,255,.05);
        -webkit-app-region:no-drag;app-region:no-drag;
    }
    #lyrProgWrap{position:relative;height:16px;cursor:pointer;display:flex;align-items:center;margin-bottom:2px;}
    #lyrProgTrack{flex:1;height:4px;background:rgba(255,255,255,.2);border-radius:4px;overflow:hidden;
        transition:height .2s ease;}
    #lyrProgWrap:hover #lyrProgTrack{height:7px;}
    #lyrProgFill{height:100%;background:rgba(255,255,255,.9);border-radius:4px;}
    .ltimes{display:flex;justify-content:space-between;margin-bottom:6px;}
    .ltm{font-size:10px;font-weight:600;color:var(--txt-3);font-variant-numeric:tabular-nums;}

    .lctrlrow{display:flex;align-items:center;justify-content:space-between;}
    .lb{background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
        border-radius:12px;color:rgba(255,255,255,.92);position:relative;
        transition:color .14s,background .14s,transform .13s cubic-bezier(.34,1.56,.64,1);}
    .lb:hover{background:var(--glass-hi);}
    .lb:active{transform:scale(.8);}
    .lb svg{fill:currentColor;display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,.35));}
    .lb.lsm{width:38px;height:38px;color:rgba(255,255,255,.6);} .lb.lsm svg{width:16px;height:16px;}
    .lb.lsm:hover{color:#fff;}
    .lb.lmd{width:46px;height:46px;} .lb.lmd svg{width:23px;height:23px;}
    .lb.on{color:var(--accent) !important;}
    .lplay{width:54px !important;height:54px !important;}
    .lplay svg{width:28px !important;height:28px !important;}
    .lplay:active{transform:scale(.78) !important;}

    /* Status / spinner */
    .status{display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:36px 0;gap:12px;opacity:.45;}
    .status .ico svg{width:30px;height:30px;fill:rgba(255,255,255,.7);}
    .status .msg{font-size:13px;font-weight:600;letter-spacing:-.01em;}
    .spinner{width:24px;height:24px;border:2.5px solid rgba(255,255,255,.12);
        border-top-color:rgba(255,255,255,.65);border-radius:50%;animation:spin .65s linear infinite;}
    @keyframes spin{to{transform:rotate(360deg)}}

    /* Settings — glass sheet */
    #settings{position:fixed;inset:0;background:rgba(12,12,16,.55);
        backdrop-filter:blur(44px) saturate(1.6);-webkit-backdrop-filter:blur(44px) saturate(1.6);
        z-index:200;display:none;flex-direction:column;
        -webkit-app-region:no-drag;app-region:no-drag;}
    #settings.open{display:flex;animation:sfade .2s cubic-bezier(.2,.9,.3,1);}
    @keyframes sfade{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
    .sh{display:flex;align-items:center;justify-content:space-between;
        padding:20px 22px 14px;flex-shrink:0;}
    .shtitle{font-size:19px;font-weight:800;letter-spacing:-.02em;}
    .sx{background:var(--glass-hi);border:none;color:#fff;width:30px;height:30px;
        border-radius:50%;cursor:pointer;font-size:15px;display:flex;align-items:center;
        justify-content:center;transition:background .15s,transform .13s;
        box-shadow:inset 0 0 0 .5px var(--hairline);}
    .sx:hover{background:rgba(255,255,255,.22);}
    .sx:active{transform:scale(.85);}
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

    /* Mode-switch fade */
    .fade{animation:fi .28s cubic-bezier(.2,.9,.3,1);}
    @keyframes fi{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}
    `;

    // ─────────────────────────────────────────────
    //  ICONS (shared glyphs)
    // ─────────────────────────────────────────────
    const I_PREV    = '<svg viewBox="0 0 16 16"><path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-.7.7H1.7a.7.7 0 0 1-.7-.7V1.7a.7.7 0 0 1 .7-.7h1.6z"/></svg>';
    const I_NEXT    = '<svg viewBox="0 0 16 16"><path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-1.6z"/></svg>';
    const I_SHUFFLE = '<svg viewBox="0 0 16 16"><path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06l2.306-2.306a.75.75 0 0 0 0-1.06L13.15.922zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"/><path d="m7.5 10.723.98-1.167 1.796 2.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.306 2.306a.75.75 0 0 1 0 1.06l-2.306 2.306a.75.75 0 1 1-1.06-1.06L14.109 14H12.16a3.75 3.75 0 0 1-2.873-1.34l-1.787-2.14z"/></svg>';
    const I_REPEAT  = '<svg viewBox="0 0 16 16"><path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L7.617 13.426a.75.75 0 0 1 0-1.06l2.15-2.152a.75.75 0 1 1 1.062 1.06l-.966.967h1.887A2.25 2.25 0 0 0 14.5 9.75v-5A2.25 2.25 0 0 0 12.25 2.5h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 11.5H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75v-5z"/></svg>';
    const I_PLAY    = '<path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/>';
    const I_LYRICS  = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>';
    const I_GEAR    = '<svg viewBox="0 0 20 20"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 0 1-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 0 1 .947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 0 1 2.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 0 1 2.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 0 1 .947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 0 1-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 0 1-2.287-.947zM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" clip-rule="evenodd"/></svg>';

    // ─────────────────────────────────────────────
    //  HTML
    // ─────────────────────────────────────────────
    function buildHtml(iv) {
        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><title>WavePlayer</title>
<style>${CSS}</style></head><body>

<div id="bgWrap"><div class="bgl" id="bgA"></div><div class="bgl" id="bgB"></div></div>
<div id="ov"></div><div id="grain"></div>

<!-- Settings -->
<div id="settings">
  <div class="sh"><span class="shtitle">Settings</span><button class="sx" id="sClose">✕</button></div>
  <div class="sbody">
    <div class="scard">
      <div class="sr"><span class="slbl">Center lyrics</span><div class="tog ${centerLyrics?'on':''}" id="togCenter"></div></div>
      <div class="sr"><span class="slbl">Volume slider</span><div class="tog ${showVol?'on':''}" id="togVol"></div></div>
      <div class="sr">
        <span class="slbl">Lyrics size</span>
        <div class="fsrow">
          <input type="range" class="fsslider" id="fsSlider" min="14" max="34" value="${fontSize}">
          <span class="fsval" id="fsVal">${fontSize}px</span>
        </div>
      </div>
    </div>
  </div>
</div>

<div id="root">

  <!-- ══ COMPACT ══ -->
  <div id="compact" style="display:${mode==='compact'?'flex':'none'}">
    <img class="ca paused" id="cArt" src="" alt="Album art">
    <div class="ci">
      <div class="mqwrap ct"><span class="mq" id="cTitle">Loading…</span></div>
      <span class="cr" id="cArtist">—</span>
      <div class="cp" id="cPT"><div class="cpt"><div class="cpf" id="cPF" style="width:0%"></div></div></div>
    </div>
    <div class="cbtns">
      <div class="cpill">
        <button class="cb" id="cPrev" title="Previous">${I_PREV}</button>
        <button class="cb cplay" id="cPlay" title="Play/Pause"><svg viewBox="0 0 16 16" id="cPlayIco">${I_PLAY}</svg></button>
        <button class="cb" id="cNext" title="Next">${I_NEXT}</button>
      </div>
      <button class="cb csec" id="cHeart" title="Like"><svg viewBox="0 0 16 16" id="cHIco">${H_LINE}</svg></button>
      <button class="cb csec" id="cLyrics" title="Lyrics">${I_LYRICS}</button>
      <button class="cb csec" id="cExpand" title="Expand"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>
      <button class="cb csec" id="cClose" title="Close player"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
    </div>
  </div>

  <!-- ══ EXPANDED ══ -->
  <div id="expanded" style="display:${mode==='expanded'?'flex':'none'}">
    <div class="dh"><div class="dp"></div></div>
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
    <div id="ctrlCard">
      <div id="progSec">
        <div class="pw" id="ePW">
          <div class="pt"><div class="pf" id="ePF" style="width:0%"></div></div>
        </div>
        <div class="times"><span class="tm" id="eEl">0:00</span><span class="tm" id="eDur">0:00</span></div>
      </div>
      <div id="ctrlSec">
        <div class="ctrlrow">
          <button class="eb sm" id="eShuffle" title="Shuffle">${I_SHUFFLE}</button>
          <button class="eb md" id="ePrev" title="Previous">${I_PREV}</button>
          <button class="eb md eplay" id="ePlay" title="Play/Pause"><svg viewBox="0 0 16 16" id="ePlayIco">${I_PLAY}</svg></button>
          <button class="eb md" id="eNext" title="Next">${I_NEXT}</button>
          <button class="eb sm" id="eRepeat" title="Repeat">${I_REPEAT}<span class="rbadge">1</span></button>
        </div>
      </div>
      <div id="volSec" style="${showVol?'':'display:none'}">
        <button class="vb" id="volBtn">${vIco(iv)}</button>
        <input type="range" class="vs" id="volSlider" min="0" max="100" value="${iv}">
        <button class="vb" style="pointer-events:none">${vIco(100)}</button>
      </div>
      <div id="expFooter">
        <button class="foot-btn" id="eLyrBtn">${I_LYRICS} Lyrics</button>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="foot-icon" id="eCollapse" title="Compact view">
            <svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
          </button>
          <button class="foot-icon" id="eGear" title="Settings">${I_GEAR}</button>
          <button class="foot-icon" id="eClose" title="Close player">
            <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ══ LYRICS MODE ══ -->
  <div id="lyrMode" style="display:${mode==='lyrics'?'flex':'none'}">
    <div class="dh"><div class="dp"></div></div>
    <div id="lyrHeader">
      <img id="lyrArtThumb" src="" alt="Album art">
      <div class="it">
        <div class="mqwrap lyrtitle"><span class="mq" id="lyrTitle">Loading…</span></div>
        <div id="lyrArtist">—</div>
      </div>
      <button class="lyrh-btn" id="lyrHeart" title="Like"><svg viewBox="0 0 16 16" id="lHIco">${H_LINE}</svg></button>
      <button class="lyrh-btn" id="lyrBack" title="Back to player">
        <svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
      </button>
      <button class="lyrh-btn" id="lyrClose" title="Close player">
        <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
      <button class="lyrh-btn" id="lyrGear" title="Settings">${I_GEAR}</button>
    </div>

    <div id="lyrWrap">
      <div id="lyrScroll" class="${centerLyrics?'centered':''}" style="--lsz:${fontSize}px">
        <div class="status"><div class="spinner"></div></div>
      </div>
    </div>

    <div id="lyrCtrl">
      <div id="lyrProgWrap">
        <div id="lyrProgTrack"><div id="lyrProgFill" style="width:0%"></div></div>
      </div>
      <div class="ltimes"><span class="ltm" id="lEl">0:00</span><span class="ltm" id="lDur">0:00</span></div>
      <div class="lctrlrow">
        <button class="lb lsm" id="lShuffle" title="Shuffle">${I_SHUFFLE}</button>
        <button class="lb lmd" id="lPrev" title="Previous">${I_PREV}</button>
        <button class="lb lmd lplay" id="lPlay" title="Play/Pause"><svg viewBox="0 0 16 16" id="lPlayIco">${I_PLAY}</svg></button>
        <button class="lb lmd" id="lNext" title="Next">${I_NEXT}</button>
        <button class="lb lsm" id="lRepeat" title="Repeat">${I_REPEAT}<span class="rbadge">1</span></button>
      </div>
    </div>
  </div>

</div>
</body></html>`;
    }

    // ─────────────────────────────────────────────
    //  OPEN PiP
    // ─────────────────────────────────────────────
    async function openPip() {
        if (pipWindow && !pipWindow.closed) { pipWindow.close(); pipWindow = null; return; }
        currentTrackUri = null;
        Object.assign(prev, { pct:-1, dur:-1, playing:null, heart:null, shuffle:null, repeat:null, vol:-1, idx:-1, _el:0 });

        const sz = SZ[mode] || SZ.expanded;
        if ('documentPictureInPicture' in window) {
            try { pipWindow = await window.documentPictureInPicture.requestWindow({ width:sz.w, height:sz.h }); setupPip(pipWindow); return; }
            catch(e) { console.warn('[WavePlayer]', e); }
        }
        try {
            const left = window.screen.width - sz.w - 30;
            pipWindow = window.open('about:blank','WavePlayer',`width=${sz.w},height=${sz.h},left=${left},top=30,resizable=yes`);
            if (pipWindow) setupPip(pipWindow);
            else Spicetify.showNotification('WavePlayer: window blocked', true);
        } catch(e) { Spicetify.showNotification('WavePlayer: error', true); }
    }

    // ─────────────────────────────────────────────
    //  SETUP
    // ─────────────────────────────────────────────
    function setupPip(win) {
        const doc = win.document;
        const iv = Math.round((Spicetify.Player.getVolume()||0)*100);
        doc.write(buildHtml(iv)); doc.close();

        const $ = id => doc.getElementById(id);

        const bgA         = $('bgA');
        const bgB         = $('bgB');
        const compactEl   = $('compact');
        const expandedEl  = $('expanded');
        const lyrModeEl   = $('lyrMode');
        const lyrScroll   = $('lyrScroll');
        const settings    = $('settings');
        const volSec      = $('volSec');
        let   bgFlip      = false;

        // ── Mode switch ──
        function setMode(m) {
            mode = m;
            localStorage.setItem('wp7-mode', mode);
            try { win.resizeTo(SZ[mode].w, SZ[mode].h); } catch {}
            compactEl.style.display  = mode==='compact'  ? 'flex' : 'none';
            expandedEl.style.display = mode==='expanded' ? 'flex' : 'none';
            lyrModeEl.style.display  = mode==='lyrics'   ? 'flex' : 'none';
            volSec.style.display = (showVol && mode==='expanded') ? 'flex' : 'none';
            const el = mode==='compact' ? compactEl : mode==='expanded' ? expandedEl : lyrModeEl;
            el.classList.add('fade');
            setTimeout(() => el.classList.remove('fade'), 320);
        }

        // ── Palette application ──
        function applyPalette(p) {
            if (!p) return;
            const { dom: d, acc: a } = p;
            doc.documentElement.style.setProperty('--accent', `rgb(${a.r},${a.g},${a.b})`);
            doc.documentElement.style.setProperty('--accent-glow', `rgba(${a.r},${a.g},${a.b},.32)`);
            doc.body.style.background = `rgb(${Math.round(d.r*.22)},${Math.round(d.g*.22)},${Math.round(d.b*.22)})`;
        }

        // ── Marquee: scroll long titles, ellipsis-free ──
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

        // ── Background crossfade ──
        function setBackground(img) {
            const next = bgFlip ? bgA : bgB;
            const cur  = bgFlip ? bgB : bgA;
            next.style.backgroundImage = `url('${img.replace(/'/g,"\\'")}')`;
            next.classList.add('show');
            cur.classList.remove('show');
            bgFlip = !bgFlip;
        }

        // ── Track load ──
        async function loadTrack(track) {
            if (!track) return;
            const name   = track.name || 'Unknown';
            const artist = track.artists?.map(a=>a.name).join(', ') || '—';
            const img    = track.album?.images?.[0]?.url || track.metadata?.image_url || '';

            marquee($('cTitle'), name);
            marquee($('eTitle'), name);
            marquee($('lyrTitle'), name);
            $('cArtist').textContent  = artist;
            $('eArtist').textContent  = artist;
            $('lyrArtist').textContent = artist;

            if (img) {
                $('cArt').src = img;
                $('artImg').src = img;
                $('lyrArtThumb').src = img;
                setBackground(img);
                getColors(img).then(p => { if (p) applyPalette(p); });
            }

            lyrScroll.innerHTML = '<div class="status"><div class="spinner"></div></div>';
            currentLyrics = await fetchLyrics(track.uri);
            renderLyrics();
            prev.idx = -1;
        }

        function renderLyrics() {
            if (!currentLyrics?.lines?.length) {
                lyrScroll.innerHTML = `<div class="status"><div class="ico"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div><div class="msg">No lyrics available</div></div>`;
                return;
            }
            lyrScroll.innerHTML = currentLyrics.lines.map((l,i) =>
                `<div class="lyric" data-t="${l.t}" data-i="${i}">${esc(l.text)}</div>`
            ).join('');
        }

        // ── Seek helper ──
        function seekFromEvent(el, e) {
            const r = el.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            if (lastDuration > 0) Spicetify.Player.seek(Math.round(ratio * lastDuration));
        }

        // ── Control wiring: compact ──
        $('cPrev').onclick   = () => Spicetify.Player.back();
        $('cPlay').onclick   = () => Spicetify.Player.togglePlay();
        $('cNext').onclick   = () => Spicetify.Player.next();
        $('cHeart').onclick  = () => Spicetify.Player.toggleHeart();
        $('cExpand').onclick = () => setMode('expanded');
        $('cLyrics').onclick = () => setMode('lyrics');
        $('cClose').onclick  = () => { try { pipWindow?.close(); } catch(e){} };
        $('cPT').onclick     = e => seekFromEvent($('cPT'), e);

        // ── Control wiring: expanded ──
        const cycleRepeat = () => {
            const cur = Spicetify.Player.getRepeat?.() || 0;
            Spicetify.Player.setRepeat?.((cur + 1) % 3);
            prev.repeat = null;
        };
        $('ePrev').onclick    = () => Spicetify.Player.back();
        $('ePlay').onclick    = () => Spicetify.Player.togglePlay();
        $('eNext').onclick    = () => Spicetify.Player.next();
        $('eHeart').onclick   = () => Spicetify.Player.toggleHeart();
        $('eShuffle').onclick = () => { Spicetify.Player.toggleShuffle(); prev.shuffle=null; };
        $('eRepeat').onclick  = cycleRepeat;
        $('eLyrBtn').onclick  = () => setMode('lyrics');
        $('eCollapse').onclick= () => setMode('compact');
        $('eGear').onclick    = () => settings.classList.add('open');
        $('eClose').onclick   = () => { try { pipWindow?.close(); } catch(e){} };
        $('ePW').onclick      = e => seekFromEvent($('ePW'), e);

        // ── Control wiring: volume ──
        const volSlider = $('volSlider');
        const volBtn    = $('volBtn');
        function paintVol(v) {
            volSlider.style.background =
                `linear-gradient(90deg,rgba(255,255,255,.9) ${v}%,rgba(255,255,255,.16) ${v}%)`;
        }
        paintVol(iv);
        volSlider.oninput = e => {
            const v=parseInt(e.target.value); Spicetify.Player.setVolume(v/100);
            volBtn.innerHTML=vIco(v); paintVol(v);
        };
        volBtn.onclick = () => {
            const cur=Math.round((Spicetify.Player.getVolume()||0)*100);
            if(cur>0){volBtn.dataset.prev=cur;Spicetify.Player.setVolume(0);volSlider.value=0;}
            else{const p=parseInt(volBtn.dataset.prev||'50');Spicetify.Player.setVolume(p/100);volSlider.value=p;}
            const v=parseInt(volSlider.value);
            volBtn.innerHTML=vIco(v); paintVol(v);
        };

        // ── Control wiring: lyrics mode ──
        $('lyrHeart').onclick  = () => Spicetify.Player.toggleHeart();
        $('lyrBack').onclick   = () => setMode('expanded');
        $('lyrClose').onclick  = () => { try { pipWindow?.close(); } catch(e){} };
        $('lyrGear').onclick   = () => settings.classList.add('open');
        $('lPrev').onclick     = () => Spicetify.Player.back();
        $('lPlay').onclick     = () => Spicetify.Player.togglePlay();
        $('lNext').onclick     = () => Spicetify.Player.next();
        $('lShuffle').onclick  = () => { Spicetify.Player.toggleShuffle(); prev.shuffle=null; };
        $('lRepeat').onclick   = cycleRepeat;
        $('lyrProgWrap').onclick = e => seekFromEvent($('lyrProgWrap'), e);

        // Lyric line seek
        lyrScroll.onclick = e => {
            const el=e.target.closest('.lyric');
            if(el?.dataset.t) Spicetify.Player.seek(parseInt(el.dataset.t));
        };

        // ── Settings ──
        $('sClose').onclick   = () => settings.classList.remove('open');
        $('togCenter').onclick = () => {
            centerLyrics=!centerLyrics;
            $('togCenter').classList.toggle('on',centerLyrics);
            lyrScroll.classList.toggle('centered',centerLyrics);
            localStorage.setItem('wp7-center',centerLyrics);
        };
        $('togVol').onclick = () => {
            showVol=!showVol;
            $('togVol').classList.toggle('on',showVol);
            volSec.style.display=(showVol&&mode==='expanded')?'flex':'none';
            localStorage.setItem('wp7-vol',showVol);
        };
        $('fsSlider').oninput = e => {
            fontSize=parseInt(e.target.value);
            $('fsVal').textContent=`${fontSize}px`;
            lyrScroll.style.setProperty('--lsz',`${fontSize}px`);
            localStorage.setItem('wp7-fs',fontSize);
        };

        // ── Keyboard shortcuts ──
        doc.addEventListener('keydown', e => {
            if (e.target?.tagName === 'INPUT') return;
            const sp = Spicetify.Player;
            switch (e.key) {
                case ' ': e.preventDefault(); sp.togglePlay(); break;
                case 'ArrowRight': if (lastDuration>0) sp.seek(Math.min(lastDuration, (sp.getProgress?.()||0)+5000)); break;
                case 'ArrowLeft':  sp.seek(Math.max(0, (sp.getProgress?.()||0)-5000)); break;
                case 'ArrowUp':   e.preventDefault(); sp.setVolume(Math.min(1,(sp.getVolume()||0)+0.05)); break;
                case 'ArrowDown': e.preventDefault(); sp.setVolume(Math.max(0,(sp.getVolume()||0)-0.05)); break;
                case 'l': case 'L': setMode(mode==='lyrics' ? 'expanded' : 'lyrics'); break;
                case 'Escape':
                    if (settings.classList.contains('open')) settings.classList.remove('open');
                    else if (mode==='lyrics') setMode('expanded');
                    break;
            }
        });

        // ── rAF update loop ──
        const PAUSE_P = '<path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7H2.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-2.6z"/>';

        function tick() {
            rafId = win.requestAnimationFrame(tick);
            const sp = Spicetify.Player, data = sp.data, track = data?.item;

            // Track change
            if (track?.uri && track.uri !== currentTrackUri) {
                currentTrackUri = track.uri;
                loadTrack(track);
            }

            // Play state
            const playing = sp.isPlaying();
            if (playing !== prev.playing) {
                prev.playing = playing;
                const ico = playing ? PAUSE_P : I_PLAY;
                $('cPlayIco').innerHTML = ico;
                $('ePlayIco').innerHTML = ico;
                $('lPlayIco').innerHTML = ico;
                $('cArt').className = `ca${playing?'':' paused'}`;
                $('artImg').className = playing ? 'playing' : 'paused';
            }

            // Heart — synced from actual library state
            const heart = !!(sp.getHeart?.());
            if (heart !== prev.heart) {
                prev.heart = heart;
                const ico  = heart ? H_FILL : H_LINE;
                $('cHIco').innerHTML  = ico;
                $('eHIco').innerHTML  = ico;
                $('lHIco').innerHTML  = ico;
                $('cHeart').className = `cb${heart?' hon':''}`;
                $('eHeart').className = `hb${heart?' liked':''}`;
                $('lyrHeart').className = `lyrh-btn${heart?' liked':''}`;
            }

            // Shuffle / Repeat (repeat: 0 off · 1 context · 2 track)
            const shuffle = !!(sp.getShuffle?.());
            if (shuffle !== prev.shuffle) {
                prev.shuffle = shuffle;
                $('eShuffle').classList.toggle('on', shuffle);
                $('lShuffle').classList.toggle('on', shuffle);
            }
            const repeat = sp.getRepeat?.() ?? 0;
            if (repeat !== prev.repeat) {
                prev.repeat = repeat;
                $('eRepeat').classList.toggle('on', repeat > 0);
                $('lRepeat').classList.toggle('on', repeat > 0);
                $('eRepeat').classList.toggle('r1', repeat === 2);
                $('lRepeat').classList.toggle('r1', repeat === 2);
            }

            // Progress
            const pos = sp.getProgress?.() ?? 0;
            const dur = Number(track?.duration?.milliseconds || track?.duration_ms || track?.metadata?.duration || 0);
            lastDuration = dur;
            const pct = dur > 0 ? Math.min(100, (pos/dur)*100) : 0;
            const ps = pct.toFixed(2) + '%';

            if (Math.abs(pct - prev.pct) > 0.06) {
                prev.pct = pct;
                $('cPF').style.width  = ps;
                $('ePF').style.width  = ps;
                $('lyrProgFill').style.width = ps;
            }
            if (dur !== prev.dur) {
                prev.dur = dur;
                $('eEl').textContent  = fmt(pos);
                $('eDur').textContent = fmt(dur);
                $('lEl').textContent  = fmt(pos);
                $('lDur').textContent = fmt(dur);
            } else {
                const rnd = Math.round(pos/250)*250;
                if (Math.abs(rnd-(prev._el||0)) >= 250) {
                    prev._el = rnd;
                    const fs = fmt(pos);
                    $('eEl').textContent = fs;
                    $('lEl').textContent = fs;
                }
            }

            // Volume
            if (doc.activeElement !== volSlider) {
                const v = Math.round((sp.getVolume()||0)*100);
                if (v !== prev.vol) {
                    prev.vol = v;
                    volSlider.value = v;
                    volBtn.innerHTML = vIco(v);
                    paintVol(v);
                }
            }

            // Active lyric
            if (currentLyrics?.synced && mode === 'lyrics') {
                const lines = currentLyrics.lines;
                let ai = -1;
                for (let i=lines.length-1; i>=0; i--) { if(pos>=lines[i].t){ai=i;break;} }
                if (ai !== prev.idx) {
                    prev.idx = ai;
                    lyrScroll.querySelectorAll('.lyric').forEach((el,idx) => {
                        const was = el.classList.contains('active');
                        el.classList.remove('active','past');
                        if (idx===ai) { el.classList.add('active'); if(playing&&!was) el.scrollIntoView({behavior:'smooth',block:'center'}); }
                        else if (idx<ai) el.classList.add('past');
                    });
                }
            }
        }

        // Cleanup
        win.addEventListener('pagehide', () => {
            pipWindow = null;
            if (rafId !== null) { win.cancelAnimationFrame(rafId); rafId = null; }
        });

        // Init
        const track = Spicetify.Player.data?.item;
        if (track) { currentTrackUri = track.uri; loadTrack(track); }
        tick();
    }

    // ─────────────────────────────────────────────
    //  LAUNCHER — take over Spotify's native miniplayer button
    // ─────────────────────────────────────────────
    const MINI_SEL = '[data-testid="pip-toggle-button"],[aria-label="Open Miniplayer"],[aria-label="Open miniplayer"]';
    document.addEventListener('click', e => {
        const btn = e.target.closest?.(MINI_SEL);
        if (!btn) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        openPip();
    }, true);

    // Fallback: if Spotify's miniplayer button can't be found, add a topbar button instead
    setTimeout(() => {
        if (!document.querySelector(MINI_SEL) && Spicetify.Topbar?.Button) {
            new Spicetify.Topbar.Button(
                'WavePlayer',
                `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`,
                openPip, false
            );
        }
    }, 8000);

    console.log('[WavePlayer v8] Ready — Liquid Glass UI');
})();
