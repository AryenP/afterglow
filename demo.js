// The home page's Mac screen: the lock screen in either look, the edge light
// in each of its modes, and a song drawing itself as constellations with the
// app's own layout (Constellation.swift: the same FNV-1a seed from the line's
// text, the same SplitMix64 draws, the same clearance score). Try a song and
// its timed lyrics come from LRCLIB, its artwork from iTunes, and the whole
// site takes the album's colours, as the app does.

(() => {
  const device = document.querySelector('.device');
  const canvas = document.getElementById('sky');
  if (!device || !canvas) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  const MASK = (1n << 64n) - 1n;

  // ---------- the lock screen around the stars ----------
  const clock = device.querySelector('.lock-time'), date = device.querySelector('.lock-date');
  function tick() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
    date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  tick();
  setInterval(tick, 15000);

  // the highlight behind a group slides to whichever option is chosen
  function placeThumb(seg) {
    const on = seg.querySelector('[aria-checked="true"]');
    if (!on || !on.offsetWidth) return;
    seg.style.setProperty('--thumb-x', `${on.offsetLeft}px`);
    seg.style.setProperty('--thumb-w', `${on.offsetWidth}px`);
    seg.classList.add('has-thumb');
  }
  const segs = [...document.querySelectorAll('.seg')];
  const placeAll = () => segs.forEach(placeThumb);
  placeAll();
  if (document.fonts) document.fonts.ready.then(placeAll);
  addEventListener('resize', placeAll);

  function choose(group, attr) {
    const buttons = [...document.querySelectorAll(`[data-${attr}]`)].filter(b => b.tagName === 'BUTTON');
    // A radio group: Tab lands on the chosen option, the arrow keys move the choice.
    const roving = () => buttons.forEach(o => { o.tabIndex = o.getAttribute('aria-checked') === 'true' ? 0 : -1; });
    roving();
    buttons.forEach((b, i) => {
      b.addEventListener('click', () => {
        buttons.forEach(o => o.setAttribute('aria-checked', String(o === b)));
        roving();
        const seg = b.closest('.seg');
        if (seg) { seg.classList.add('is-sliding'); placeThumb(seg); }
        device.dataset[attr] = b.dataset[attr];
        if (attr === 'look' && sky) { const words = sky.words.join(' '); show(words, sky.pace, sky.lead, true); }
      });
      b.addEventListener('keydown', e => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        const to = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : step ? (i + step + buttons.length) % buttons.length : null;
        if (to === null) return;
        e.preventDefault();
        buttons[to].click();
        buttons[to].focus();
      });
    });
  }
  choose('look', 'look');
  choose('light', 'light');

  // ---------- the constellation ----------
  function fnv1a(text) {
    let h = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(text)) h = ((h ^ BigInt(byte)) * 0x100000001b3n) & MASK;
    return h;
  }
  function splitMix(seed) {
    let state = seed;
    return () => {
      state = (state + 0x9e3779b97f4a7c15n) & MASK;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      z = z ^ (z >> 31n);
      return Number(z >> 11n) / 2 ** 53;
    };
  }
  const normalize = w => w.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}']/gu, '').replace(/^'+|'+$/g, '');
  const labelOf = w => w.replace(/^[()[\]{}"“”‘,.;:!?…\-–—]+|[()[\]{}"“”‘,.;:!?…\-–—]+$/g, '') || w;
  const stop = new Set('a an the and or but if so to of in on at by for with is are was be it i you me my we our your this that from as up'.split(' '));
  const labelSize = (w, u) => (11 + 27 * Math.pow(w, 1.25)) * u;
  const smooth = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

  const song = [
    'Turn the lights down low', 'Let the colours start to glow', 'Every word is burning bright',
    'Dancing on the edge of night', 'Turn the lights down low', 'Feel the rhythm of the band',
    'Stars are falling through the screen', 'Turn the lights down low',
  ];
  const step = 0.42, hold = 2.4, handover = 1.2;
  /* A tried song plays this many seconds from its chorus, round and round. */
  const CLIP = 10;
  const encores = new Map();

  let sky = null, prev = null, prevSince = 0, started = 0, size = 0, tall = 0, u = 1;
  let visible = true, frame = 0, next = 0, seen = false, playing = null;

  // The colour of the stars is the page's accent, read as it changes.
  let gold = '240,180,76';
  function readGold() {
    const c = getComputedStyle(root).getPropertyValue('--accent').trim();
    const m = c.match(/(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/);
    if (m) gold = `${Math.round(m[1])},${Math.round(m[2])},${Math.round(m[3])}`;
    else if (/^#[0-9a-f]{6}$/i.test(c)) gold = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(',');
  }

  // Where the stars go: the whole screen when it's blacked out, under the
  // clock and the card in the player look.
  function areaFor(w, h) {
    return device.dataset.look === 'player'
      ? { x: w * 0.12, y: h * 0.53, w: w * 0.76, h: h * 0.38 }
      : { x: w * 0.08, y: h * 0.14, w: w * 0.84, h: h * 0.7 };
  }

  function build(text, pace = step, lead = 0.35, recount = false) {
    const words = text.split(/\s+/).filter(Boolean).slice(0, 12);
    const index = new Map(), node = [], visits = [];
    words.forEach((word, j) => {
      const key = normalize(word);
      if (key && index.has(key)) { node.push(index.get(key)); visits[index.get(key)].push(j); }
      else { if (key) index.set(key, visits.length); node.push(visits.length); visits.push([j]); }
    });
    // Glue words small, the last word (the held note) biggest.
    const weights = words.map((word, j) => {
      const key = normalize(word);
      const base = stop.has(key) ? 0.14 : Math.min(0.7, 0.28 + 0.06 * key.length);
      return Math.min(1, base + (j === words.length - 1 ? 0.3 : 0));
    });
    const scale = device.dataset.look === 'player' ? u * 0.78 : u;
    const area = areaFor(size, tall);
    const rand = splitMix(fnv1a(words.join(' ')));
    const reach = visits.map(v => {
      const w = Math.min(1, Math.max(...v.map(j => weights[j])) + 0.12 * (v.length - 1));
      return words[v[0]].length * labelSize(w, scale) * 0.32 + 10 * scale;
    });
    let points = [];
    let lastY = area.y + area.h / 2;
    for (let j = 0; j < visits.length; j++) {
      const flow = (j + 0.5) / visits.length;
      const inset = Math.min(reach[j], area.w * 0.2);
      const lane = { x: area.x + inset, w: area.w - 2 * inset };
      let best = { x: lane.x + lane.w / 2, y: area.y + area.h / 2 }, bestScore = -Infinity;
      for (let k = 0; k < 14; k++) {
        const x = lane.x + lane.w * (0.55 * flow + 0.45 * rand());
        const y = area.y + area.h * rand();
        const clearance = points.length
          ? Math.min(...points.map((p, q) => Math.hypot(p.x - x, (p.y - y) * 1.6) - reach[q] - reach[j]))
          : area.w;
        const jump = Math.abs(y - lastY) / area.h;
        const score = Math.min(clearance, area.w * 0.3) + (jump > 0.25 ? area.h * 0.2 : 0);
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
      points.push(best);
      lastY = best.y;
    }
    // A line sung before comes back turned a few degrees further, like the sky.
    const key = words.join(' ').toLowerCase();
    const encore = recount ? Math.max(0, (encores.get(key) || 1) - 1) : encores.get(key) || 0;
    encores.set(key, encore + 1);
    const echo = encore > 0 ? points : null;
    if (encore > 0) {
      const a = (encore % 2 ? 1 : -1) * encore * 5 * Math.PI / 180;
      const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
      points = points.map(p => ({
        x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a),
        y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a),
      }));
    }
    const timing = words.map((_, j) => {
      const start = lead + j * pace;
      return { start, end: start + (j === words.length - 1 ? Math.max(0.5, pace * 1.5) : pace * 0.75) };
    });
    return { words, node, visits, weights, points, echo, timing, area, scale, pace, lead, done: timing[timing.length - 1].end };
  }

  function starPath(x, y, r) {
    const k = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + k, y - k, x + r, y);
    ctx.quadraticCurveTo(x + k, y + k, x, y + r);
    ctx.quadraticCurveTo(x - k, y + k, x - r, y);
    ctx.quadraticCurveTo(x - k, y - k, x, y - r);
    ctx.closePath();
  }
  function glow(x, y, r, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${gold},${alpha})`);
    g.addColorStop(1, `rgba(${gold},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  const dust = (() => { const r = splitMix(0xa57e6105n); return Array.from({ length: 60 }, () => ({ x: r(), y: r(), s: 0.7 + r() * 0.9, v: 0.6 + r() * 1.4, p: r() * 6.3 })); })();

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    size = Math.round((canvas.clientWidth || 800) * dpr);
    tall = Math.round((canvas.clientHeight || 500) * dpr);
    canvas.width = size;
    canvas.height = tall;
    u = Math.min(size / 820, tall / 512);
  }

  /* One line's constellation at time t into it, at opacity out. */
  function paint(s, t, out, clock) {
    const { words, node, visits, weights, points, echo, timing, area, done } = s;
    const su = s.scale;
    ctx.globalAlpha = out;
    if (echo) {
      const wait = 1 - smooth((t - done) / 0.8);
      ctx.setLineDash([3 * su, 6 * su]);
      ctx.strokeStyle = `rgba(${gold},${0.28 * wait * out})`;
      ctx.lineWidth = su;
      ctx.beginPath();
      node.forEach((n, j) => { const p = echo[n]; j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (let j = 1; j < words.length; j++) {
      if (t < timing[j].start || node[j - 1] === node[j]) continue;
      const k = smooth((t - timing[j].start) / 0.35);
      const a = points[node[j - 1]], b = points[node[j]];
      const strength = Math.min(weights[j - 1], weights[j]);
      ctx.strokeStyle = `rgba(${gold},${(0.32 + 0.3 * strength) * out})`;
      ctx.lineWidth = Math.max(0.7, (0.8 + 0.8 * strength) * su);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k); ctx.stroke();
      if (echo && k < 1) glow(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 9 * su, 0.8 * out);
    }
    visits.forEach((v, n) => {
      const sung = v.filter(j => t >= timing[j].start);
      if (!sung.length) return;
      const p = points[n], latest = sung[sung.length - 1];
      const w = Math.min(1, Math.max(...sung.map(j => weights[j])) + 0.12 * (sung.length - 1));
      const appear = smooth((t - timing[sung[0]].start) / 0.25);
      const settle = smooth((t - timing[latest].end) / 0.4);
      const twinkle = reduced ? 1 : 0.88 + 0.12 * Math.sin(clock * 2.3 + n * 1.7);
      if (settle < 1) {
        const r = (10 + 10 * w) * su * appear;
        ctx.globalAlpha = (1 - settle) * out;
        glow(p.x, p.y, r * 1.7, 0.55);
        ctx.fillStyle = `rgba(${gold},0.92)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        starPath(p.x, p.y, r * 0.72); ctx.fill();
      }
      if (settle > 0) {
        const r = (4 + 6.5 * w) * su * twinkle * appear;
        ctx.globalAlpha = settle * out;
        glow(p.x, p.y, r * 2.2, 0.22 + 0.25 * w);
        ctx.fillStyle = `rgb(${gold})`;
        starPath(p.x, p.y, r); ctx.fill();
      }
      ctx.globalAlpha = out;
      const lit = 1 - settle;
      ctx.font = `${w > 0.6 ? 700 : w > 0.3 ? 600 : 500} ${labelSize(w, su) * (1 + 0.12 * lit)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const below = p.y < area.y + area.h * 0.78;
      const gap = (8 + 10 * w) * su + 8 * su * lit;
      ctx.textBaseline = below ? 'top' : 'bottom';
      ctx.shadowColor = `rgba(${gold},${(0.3 + 0.4 * w + 0.3 * lit) * out})`;
      ctx.shadowBlur = (4 + 8 * w) * su;
      ctx.fillStyle = `rgba(${gold},${0.45 + 0.4 * w + 0.15 * lit})`;
      ctx.fillText(labelOf(words[latest]), p.x, p.y + (below ? gap : -gap));
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    readGold();
    const t = reduced ? (sky ? sky.done + 1 : 0) : (now - started) / 1000;
    const clock = now / 1000;
    ctx.clearRect(0, 0, size, tall);
    if (device.dataset.look !== 'player') {
      for (const d of dust) {
        const a = 0.08 + 0.22 * (0.5 + 0.5 * Math.sin(clock * d.v + d.p));
        ctx.fillStyle = `rgba(${gold},${(reduced ? 0.18 : a) * 0.7})`;
        ctx.beginPath(); ctx.arc(d.x * size, d.y * tall, d.s * u, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (!sky) return;
    // A line's stars stay up and fade only as the next line draws, as in the app.
    if (prev && !reduced) {
      const k = 1 - smooth((now - prevSince) / 1000 / handover);
      if (k > 0) paint(prev, prev.done + 10, k, clock);
      else prev = null;
    }
    paint(sky, t, 1, clock);

    if (reduced) return;
    if (playing) {
      const clipTime = (now - playing.began) / 1000;
      // The chosen song stays: after a short breath its chorus comes round again,
      // drawn over last time's shape the way a returning chorus is in the app.
      if (clipTime > CLIP + 1.2) {
        playing.began = now;
        playing.i = 0;
        const line = playing.lines[0];
        show(line.text, line.pace, 0.05);
      } else if (clipTime > CLIP) {
        // Hold the last line during the breath.
      } else if (playing.i + 1 < playing.lines.length && clipTime >= playing.lines[playing.i + 1].at) {
        const line = playing.lines[++playing.i];
        show(line.text, line.pace, 0.05);
      }
    } else if (t > sky.done + hold) {
      show(song[(next = (next + 1) % song.length)]);
    }
  }

  function loop(now) {
    draw(now);
    if (visible && !reduced) frame = requestAnimationFrame(loop);
  }
  function show(text, pace, lead, keepTime = false) {
    if (!size) resize();
    if (sky && !keepTime) { prev = sky; prevSince = performance.now(); }
    else if (keepTime) prev = null;
    const elapsed = keepTime && sky ? performance.now() - started : 0;
    sky = build(text.trim().replace(/\s+/g, ' ') || song[0], pace, lead, keepTime);
    started = performance.now() - elapsed;
    if (reduced) requestAnimationFrame(draw);
  }

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    cancelAnimationFrame(frame);
    if (!visible) return;
    // Arriving, the first line is already drawn, so the sky is never empty.
    if (!seen && sky && !playing) {
      started = performance.now() - (sky.done + 0.05) * 1000;
      seen = true;
    }
    frame = requestAnimationFrame(loop);
  }).observe(canvas);

  // ---------- try a song ----------
  const form = document.getElementById('song-form');
  const field = document.getElementById('song');
  const status = document.getElementById('song-status');
  const cardTitle = device.querySelector('.card-title'), cardArtist = device.querySelector('.card-artist');
  let request = null;

  function parseLRC(lrc) {
    const lines = [];
    for (const raw of lrc.split('\n')) {
      const text = raw.replace(/\[[^\]]*\]/g, '').trim();
      for (const m of raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) lines.push({ at: +m[1] * 60 + +m[2], text });
    }
    return lines.sort((a, b) => a.at - b.at);
  }

  // The chorus is the line sung most often; the clip starts where it's first sung.
  function chorusClip(lines) {
    const sung = lines.filter(l => l.text);
    if (!sung.length) return [];
    const counts = new Map();
    for (const l of sung) counts.set(l.text.toLowerCase(), (counts.get(l.text.toLowerCase()) || 0) + 1);
    let from = sung[0], most = 1;
    for (const l of sung) if (counts.get(l.text.toLowerCase()) > most) { most = counts.get(l.text.toLowerCase()); from = l; }
    return lines.filter(l => l.at >= from.at && l.at < from.at + CLIP && l.text).map(l => {
      const n = l.text.split(/\s+/).length;
      const until = (lines.find(m => m.at > l.at) || { at: l.at + 4 }).at;
      return { at: l.at - from.at, text: l.text, pace: Math.min(0.55, Math.max(0.12, Math.min((until - l.at) * 0.8, n * 0.5) / n)) };
    });
  }

  // The result by the artist you typed wins; otherwise LRCLIB's own order,
  // skipping uploads that put the song's title where the artist goes.
  const clean = t => (t || '').replace(/﻿/g, '').replace(/_/g, ' ').toLowerCase().trim();
  // Upload tags like "(Official Lyrics Video)" aren't part of a song's name.
  const uploadTag = /\s*[(\[][^)\]]*\b(official|lyrics?|video|audio|visuali[sz]er)\b[^)\]]*[)\]]/gi;
  const tidy = t => t.replace(/_/g, ' ').replace(uploadTag, '').replace(/\s{2,}/g, ' ').trim();
  // True when both the hit's artist and its title are in what was typed, so an upload with
  // the two swapped, or a cover by someone else, doesn't count.
  const words = t => clean(t).split(/[\s,/&]+/).filter(w => w.length > 1);
  const typed = (h, q) => {
    const query = clean(q);
    const title = tidy(h.trackName).replace(/\s*[(\[].*?[)\]]/g, '');
    return words(h.artistName).every(w => query.includes(w)) && words(title).every(w => query.includes(w));
  };
  function pick(hits, q) {
    // Uploads carry tags or the artist in the title; real entries don't, so they go first.
    const messy = h => (tidy(h.trackName) !== h.trackName.trim() ? 1 : 0) + (clean(h.trackName).includes(clean(h.artistName)) ? 1 : 0);
    const timed = hits.filter(h => h.syncedLyrics && clean(h.artistName) !== clean(h.trackName))
      .sort((a, b) => messy(a) - messy(b));
    return timed.find(h => typed(h, q)) || timed[0] || hits.find(h => h.syncedLyrics);
  }
  async function lyricsFor(q, signal) {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, { signal });
    const hits = await res.json();
    if (!Array.isArray(hits)) throw new Error('unexpected reply');
    return hits;
  }
  // What Apple Music thinks was meant: it forgives typos and ranks the original above covers.
  async function likelySong(q, signal) {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=1`, { signal });
    const { results = [] } = await res.json();
    return results[0] ? `${tidy(results[0].trackName)} ${results[0].artistName}` : null;
  }

  // ---------- the album's colours ----------
  function hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [((h * 60) + 360) % 360, max ? d / max : 0, max];
  }
  function rgbOf(h, s, v) {
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)].map(x => Math.round(x * 255));
  }
  const hex = c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
  const luminance = ([r, g, b]) => {
    const l = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
  };
  // Hue-binned and saturation-weighted, like the app's palette; the two
  // strongest hues at least 45° apart, lifted so they glow.
  async function paletteOf(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 40, 40);
    const d = x.getImageData(0, 0, 40, 40).data;
    const bins = Array.from({ length: 24 }, (_, i) => ({ i, w: 0, h: 0, s: 0 }));
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, v] = hsv(d[i], d[i + 1], d[i + 2]);
      if (s < 0.25 || v < 0.3) continue;
      const w = s * s * v, bin = bins[Math.floor(h / 15) % 24];
      bin.w += w; bin.h += h * w; bin.s += s * w;
    }
    const ranked = bins.filter(b => b.w > 0.5).sort((a, b) => b.w - a.w);
    // Black-and-white art: a cool white and a soft silver, as in the app.
    if (!ranked.length) return { accent: '#e8eef7', accent2: '#b9c0ca', ink: '#121110' };
    const lift = b => rgbOf(b.h / b.w, Math.max(0.55, Math.min(0.9, b.s / b.w)), 0.95);
    const first = ranked[0];
    const second = ranked.find(b => Math.min(Math.abs(b.i - first.i), 24 - Math.abs(b.i - first.i)) >= 3);
    const accent = lift(first);
    const accent2 = second ? lift(second) : rgbOf((first.h / first.w + 40) % 360, 0.7, 0.95);
    return { accent: hex(accent), accent2: hex(accent2), ink: luminance(accent) > 0.4 ? '#121110' : '#ffffff' };
  }

  async function artworkFor(title, artist, signal) {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${title} ${artist}`)}&entity=song&limit=10`, { signal });
    const { results = [] } = await res.json();
    const t = clean(title), a = clean(artist);
    const best = results.find(r => clean(r.trackName) === t && clean(r.artistName).includes(a.split(/[,&/]/)[0].trim()))
      || results.find(r => clean(r.trackName).startsWith(t)) || results[0];
    return best ? best.artworkUrl100.replace('100x100bb', '400x400bb') : null;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const q = field.value.trim();
    if (!q) return field.focus();
    request?.abort();
    request = new AbortController();
    form.classList.add('is-busy');
    status.textContent = `Finding “${q}”…`;
    try {
      let hit = pick(await lyricsFor(q, request.signal), q);
      // No artist typed, or nothing found: ask Apple Music what was meant, then look that up.
      if (!hit || !typed(hit, q)) {
        const meant = await likelySong(q, request.signal).catch(e => { if (e.name === 'AbortError') throw e; return null; });
        if (meant) {
          const better = pick(await lyricsFor(meant, request.signal), meant);
          if (better && better.syncedLyrics && typed(better, meant)) hit = better;
        }
      }
      const lines = hit ? chorusClip(parseLRC(hit.syncedLyrics)) : [];
      if (!lines.length) { status.textContent = `No timed lyrics for “${q}”. Try another song.`; return; }
      const artist = hit.artistName.replace(/﻿/g, '').trim();
      let title = tidy(hit.trackName.replace(/﻿/g, ''));
      if (title.toLowerCase().startsWith(artist.toLowerCase() + ' ')) title = title.slice(artist.length).replace(/^\s*[-–:]?\s*/, '');
      playing = { lines, i: 0, began: performance.now() };
      show(lines[0].text, lines[0].pace, 0.05);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
      cardTitle.textContent = title;
      cardArtist.textContent = artist;
      status.textContent = `${title} · ${artist}`;
      // Then the album's colours, for the light, the stars and the page.
      try {
        const art = await artworkFor(title, artist, request.signal);
        if (art) {
          device.style.setProperty('--art', `url("${art}")`);
          const theme = await paletteOf(art);
          if (theme) window.afterglowTheme?.apply(theme);
        }
      } catch {}
    } catch (err) {
      if (err.name !== 'AbortError') status.textContent = "Couldn't reach the lyrics library. Try again.";
    } finally {
      form.classList.remove('is-busy');
    }
  });

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); if (sky) show(sky.words.join(' '), sky.pace, sky.lead, true); }, 200);
  });
  resize();
  show(song[0]);
})();
