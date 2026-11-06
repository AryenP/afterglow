// Afterglow's site, shared by every page: the song's colours (kept from page
// to page), entrances, and copy buttons.

(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- the theme: the colours of the last song you tried ----------
  const KEY = 'afterglow-theme';
  window.afterglowTheme = {
    apply(theme, remember = true) {
      root.style.setProperty('--accent', theme.accent);
      root.style.setProperty('--accent-2', theme.accent2);
      root.style.setProperty('--accent-ink', theme.ink);
      if (remember) try { localStorage.setItem(KEY, JSON.stringify(theme)); } catch {}
    },
    reset() {
      ['--accent', '--accent-2', '--accent-ink'].forEach(p => root.style.removeProperty(p));
      try { localStorage.removeItem(KEY); } catch {}
    },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.accent) window.afterglowTheme.apply(saved, false);
  } catch {}

  // ---------- entrances ----------
  document.querySelectorAll('.rise').forEach((el, i) => el.style.setProperty('--delay', `${100 + i * 100}ms`));
  document.querySelectorAll('[data-stagger]').forEach(group =>
    group.querySelectorAll('.reveal').forEach((el, i) => el.style.setProperty('--delay', `${i * 70}ms`)));
  const reveals = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach(el => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(el => io.observe(el));
  }

  // ---------- on phones the bar steps aside while you read down, and returns when you scroll up ----------
  const bar = document.querySelector('.bar');
  if (bar) {
    let last = scrollY, queued = false;
    addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        const y = scrollY, dy = y - last;
        if (y < bar.offsetHeight * 2) bar.classList.remove('is-tucked');
        else if (Math.abs(dy) > 8) bar.classList.toggle('is-tucked', dy > 0);
        if (Math.abs(dy) > 8 || y < bar.offsetHeight * 2) last = y;
        queued = false;
      });
    }, { passive: true });
  }

  // ---------- loops rest off screen ----------
  if ('IntersectionObserver' in window) {
    const live = new IntersectionObserver(entries => {
      for (const e of entries) e.target.classList.toggle('is-offscreen', !e.isIntersecting);
    });
    document.querySelectorAll('[data-live]').forEach(el => live.observe(el));
  }

  // ---------- the guide's rail marks the section being read ----------
  const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')];
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const sections = tocLinks.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    const inBand = new Map();
    const mark = id => tocLinks.forEach(a => a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + id)));
    const spy = new IntersectionObserver(entries => {
      for (const e of entries) inBand.set(e.target.id, e.isIntersecting);
      const reading = sections.find(s => inBand.get(s.id));
      if (reading) mark(reading.id);
    }, { rootMargin: '-25% 0px -55% 0px' });
    sections.forEach(s => spy.observe(s));
    mark(sections[0].id);
  }

  // ---------- copy buttons on commands ----------
  document.querySelectorAll('.code').forEach(block => {
    const button = document.createElement('button');
    button.className = 'copy';
    button.type = 'button';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(block.querySelector('pre').innerText.trim());
        button.textContent = 'Copied';
      } catch { button.textContent = 'Select and copy'; }
      setTimeout(() => { button.textContent = 'Copy'; }, 1800);
    });
    block.appendChild(button);
  });
})();

// How close it gets: a crosshair and the share of words at any point, by pointer or arrow keys.
(() => {
  const miss = document.querySelector('.miss');
  if (!miss) return;
  const first = JSON.parse(miss.dataset.first), learned = JSON.parse(miss.dataset.learned);
  const plot = miss.querySelector('.miss-plot'), cross = miss.querySelector('.miss-cross'), tip = miss.querySelector('.miss-tip');
  const n = first.length;
  let at = n / 2;
  const share = v => `${(v * 100).toFixed(1)}%`;
  function show(i) {
    at = Math.max(0, Math.min(n - 1, i));
    const t = -1 + (at + 0.5) * (2 / n), x = (at + 0.5) / n * 100;
    const when = Math.abs(t) < 0.015 ? 'As you hear it' : `${Math.abs(t).toFixed(2)} s ${t < 0 ? 'early' : 'late'}`;
    cross.style.left = `${x}%`;
    tip.style.left = `${Math.max(16, Math.min(84, x))}%`;
    tip.innerHTML = `<b>${when}</b><em>Share of words, per 20 ms</em><span style="--c:var(--c-first)">First play<strong>${share(first[at])}</strong></span>` +
      `<span style="--c:var(--c-learned)">Once learned<strong>${share(learned[at])}</strong></span>`;
    miss.classList.add('is-hover');
  }
  plot.addEventListener('pointermove', e => {
    const r = plot.getBoundingClientRect();
    show(Math.floor((e.clientX - r.left) / r.width * n));
  });
  plot.addEventListener('pointerleave', () => miss.classList.remove('is-hover'));
  plot.addEventListener('focus', () => show(at));
  plot.addEventListener('blur', () => miss.classList.remove('is-hover'));
  plot.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(at + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1)); }
  });
})();
