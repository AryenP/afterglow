// Afterglow accounts: what the account pages share. Building the page safely
// (text is always set as text, never as markup), busy buttons, messages, the
// sign-in, new-account, code and reset forms, and a few formats.

import * as account from './afterglow-account.js';

const SVG = 'http://www.w3.org/2000/svg';

export const $ = (sel, root = document) => root.querySelector(sel);
export const framed = () => document.documentElement.classList.contains('framed');

/** Builds an element. Strings among the children become text nodes, never markup. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'hidden') el.hidden = true;
      else if (typeof v === 'function' && k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** The site's four-pointed star, from the page's own symbol. */
export function star(cls = 'star') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '#star');
  svg.append(use);
  return svg;
}

/** Shows a sentence in a live region (tone: error, ok or info), with an optional button after it. */
export function say(region, text = '', tone = 'error', action) {
  region.replaceChildren();
  region.dataset.tone = text ? tone : '';
  if (!text) return;
  region.append(h('span', null, text));
  if (action) region.append(' ', h('button', { type: 'button', class: 'text-button', onclick: action.run }, action.label));
}

/** Marks a field as needing attention, says why, and puts the cursor there. */
export function invalid(input, region, text) {
  input.setAttribute('aria-invalid', 'true');
  say(region, text);
  input.focus();
  if (typeof input.select === 'function' && input.type !== 'email') input.select();
}

// ---------- busy buttons: no double submits ----------
export const LEAVING = Symbol('leaving the page');

/** Runs a request from a button: it shows busy while the request lasts, and pressing it
 *  again meanwhile does nothing. A task that returns LEAVING keeps it busy (the page is going). */
export async function run(button, task) {
  if (button.classList.contains('is-busy')) return undefined;
  button.classList.add('is-busy');
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  let result;
  try {
    result = await task();
    return result;
  } finally {
    if (result !== LEAVING) settle(button);
  }
}
function settle(button) {
  button.classList.remove('is-busy');
  button.removeAttribute('aria-busy');
  button.disabled = button.hasAttribute('data-waiting');
}
// Back from Stripe with the browser's back button: the page comes back as it was left.
addEventListener('pageshow', (e) => { if (e.persisted) document.querySelectorAll('.is-busy').forEach(settle); });

// ---------- "send again" waits a minute ----------
const ticks = new WeakMap();
/** Keeps a button waiting until `until` (ms), its label counting down, then gives it `idle` back. */
export function waitUntil(button, until, idle) {
  clearInterval(ticks.get(button));
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(ticks.get(button));
      button.removeAttribute('data-waiting');
      if (!button.classList.contains('is-busy')) button.disabled = false;
      button.textContent = idle;
      return;
    }
    button.setAttribute('data-waiting', '');
    button.disabled = true;
    button.textContent = `Send again in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  tick();
  ticks.set(button, setInterval(tick, 250));
}

// ---------- formats ----------
const fmt = (o) => new Intl.DateTimeFormat('en-US', o);
const SHORT = fmt({ month: 'short', day: 'numeric' });
const SHORT_YEAR = fmt({ month: 'short', day: 'numeric', year: 'numeric' });
const LONG = fmt({ weekday: 'long', month: 'long', day: 'numeric' });
const LONG_YEAR = fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const asDate = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
const thisYear = (d) => d.getFullYear() === new Date().getFullYear();
/** "Dec 5", or "Jan 5, 2027" in another year. */
export const shortDay = (v) => { const d = asDate(v); return d ? (thisYear(d) ? SHORT : SHORT_YEAR).format(d) : ''; };
/** "Thursday, December 5". */
export const longDay = (v) => { const d = asDate(v); return d ? (thisYear(d) ? LONG : LONG_YEAR).format(d) : ''; };
export const isoDay = (v) => { const d = asDate(v); return d ? d.toISOString() : ''; };
/** Whole days left, counting a part day as a day. */
export const daysUntil = (v) => { const d = asDate(v); return d ? Math.max(0, Math.ceil((d - Date.now()) / 86400000)) : 0; };
export const inFuture = (v) => { const d = asDate(v); return !!d && d.getTime() > Date.now(); };
export const money = (cents) => `$${(Math.round(Number(cents) || 0) / 100).toFixed(2)}`;
export const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- the test build (test/latest.json beside the site; missing until it's published) ----------
let build;
export function testBuild() {
  build ??= (async () => {
    try {
      const where = new URL('../test/latest.json', import.meta.url);
      const r = await fetch(where, { cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return null;
      const info = await r.json();
      if (!info || typeof info.pkg_url !== 'string') return null;
      const url = new URL(info.pkg_url, where);
      // Only Afterglow's own release downloads (or a copy beside the site while testing locally).
      const release = url.href.startsWith('https://github.com/AryenP/afterglow/releases/download/');
      if (!release && url.origin !== location.origin) return null;
      return { url: url.href, version: typeof info.version === 'string' ? info.version.slice(0, 32) : '' };
    } catch { return null; }
  })();
  return build;
}

/** Opens a Stripe page (checkout or billing portal). Refuses any address that isn't Stripe's. */
export function openStripe(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname;
  if (u.protocol !== 'https:' || !(host === 'stripe.com' || host.endsWith('.stripe.com'))) return false;
  location.assign(u.href);
  return true;
}

/** Wires the Show/Hide buttons beside password fields written in the page itself. */
export function passwordToggles(root) {
  for (const toggle of root.querySelectorAll('.pw-toggle[aria-controls]:not([data-bound])')) {
    const input = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!input) continue;
    toggle.setAttribute('data-bound', '');
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- signing in, new accounts, codes and resets ----------
// A new account waiting for its code: its email (no secret) waits here so a reload comes back to the
// code step. Nothing else about accounts is ever stored (ACCOUNTS.md, "Rules for every client").
const PENDING = 'afterglow-account-pending';
const CODE_LIFE = 15 * 60 * 1000;
const RESEND_GAP = 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const goodPassword = (p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PASSWORD_RULE = 'At least 8 characters, with letters and numbers.';
const RESEND = 'Send the code again';
let mounts = 0;

/**
 * Draws the account forms into `root` and runs them.
 *   start: 'signin' or 'create'
 *   allowCreate: offer "Create an account" (the owner page doesn't)
 *   copy: titles and lines that differ per page
 *   onSignedIn({how: 'signin' | 'signup' | 'reset', changed}), onView(name)
 * Passwords stay in this closure's memory, never in storage.
 * Returns { show(view, {email}), notice(text, tone), reset() }.
 */
export function mountAuth(root, options = {}) {
  const { start = 'signin', allowCreate = true, copy = {}, onSignedIn = () => {}, onView = () => {} } = options;
  const n = ++mounts;
  const id = (name) => `auth${n}-${name}`;
  // password: the one chosen for a new account, in memory only, until it's set after the code.
  // fresh: a new account's session from the code, held while its password still needs setting.
  const state = { view: '', email: '', recovery: null, password: '', fresh: null };

  function field(key, { label, type = 'text', autocomplete, hint, attrs = {} }) {
    const inputId = id(key);
    const hintId = hint ? id(`${key}-hint`) : null;
    const input = h('input', { id: inputId, type, autocomplete, 'aria-describedby': hintId, ...attrs });
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    const wrap = h('div', { class: 'field' }, h('label', { for: inputId }, label), input,
      hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null);
    return { wrap, input };
  }
  const emailField = (key) => field(key, { label: 'Email', type: 'email', autocomplete: 'email',
    attrs: { name: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', required: true } });
  function passwordField(key, { label = 'Password', fresh = false } = {}) {
    const f = field(key, { label, type: 'password', autocomplete: fresh ? 'new-password' : 'current-password',
      hint: fresh ? PASSWORD_RULE : null,
      attrs: { name: fresh ? 'new-password' : 'password', autocapitalize: 'off', spellcheck: 'false', required: true, minlength: fresh ? 8 : null } });
    const toggle = h('button', { type: 'button', class: 'pw-toggle', 'aria-controls': f.input.id, 'aria-label': 'Show password', 'data-bound': true }, 'Show');
    const hide = () => { f.input.type = 'password'; toggle.textContent = 'Show'; toggle.setAttribute('aria-label', 'Show password'); };
    toggle.addEventListener('click', () => {
      if (f.input.type === 'text') return hide();
      f.input.type = 'text'; toggle.textContent = 'Hide'; toggle.setAttribute('aria-label', 'Hide password');
    });
    const box = h('div', { class: 'pw' });
    f.input.replaceWith(box);
    box.append(f.input, toggle);
    return { ...f, hide };
  }
  function codeField(key) {
    const f = field(key, { label: '6-digit code', autocomplete: 'one-time-code',
      attrs: { name: 'code', class: 'otp', inputmode: 'numeric', pattern: '[0-9]*', autocapitalize: 'off', spellcheck: 'false', required: true } });
    // Pasted "123 456" or "123-456" becomes 123456.
    f.input.addEventListener('input', () => {
      const digits = f.input.value.replace(/\D/g, '').slice(0, 6);
      if (digits !== f.input.value) f.input.value = digits;
    });
    return f;
  }
  const region = () => h('div', { class: 'form-msg', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const go = (label, to) => h('button', { type: 'button', class: 'text-button', onclick: () => show(to, { email: emailNow() }) }, label);
  const submitButton = (label) => h('button', { class: 'button wide', type: 'submit' }, star(), label);
  function view(name, title, line, ...body) {
    const heading = h('h2', { class: 'auth-title', id: id(`${name}-title`), tabindex: '-1' }, title);
    return h('form', { class: 'auth-view', 'data-view': name, novalidate: true, 'aria-labelledby': heading.id, hidden: true },
      heading, line ? h('p', { class: 'auth-text' }, line) : null, ...body);
  }

  // ---- sign in ----
  const si = { email: emailField('signin-email'), password: passwordField('signin-password'), msg: region(), submit: submitButton('Sign in') };
  const signinView = view('signin', copy.signinTitle || 'Sign in', copy.signinText || null,
    si.email.wrap, si.password.wrap,
    h('p', { class: 'auth-aside' }, go('Forgot your password?', 'forgot')),
    si.msg, si.submit,
    allowCreate ? h('p', { class: 'auth-switch' }, copy.createPrompt || 'New to Afterglow?', ' ', go('Create an account', 'create')) : null);

  // ---- new account ----
  const cr = { email: emailField('create-email'), password: passwordField('create-password', { fresh: true }), msg: region(), submit: submitButton(copy.createButton || 'Create account') };
  const createView = view('create', copy.createTitle || 'Create your account',
    copy.createText || "Use your email and a password. We'll email you a 6-digit code to confirm it's yours.",
    cr.email.wrap, cr.password.wrap, cr.msg, cr.submit,
    h('p', { class: 'auth-switch' }, 'Have an account?', ' ', go('Sign in', 'signin')));

  // ---- the code from a new account's email ----
  const cdEmail = h('strong', { class: 'auth-email' });
  const cd = { code: codeField('code'), password: passwordField('code-password', { label: 'Choose your password', fresh: true }),
    msg: region(), submit: submitButton('Confirm'), resend: h('button', { type: 'button', class: 'text-button' }, RESEND) };
  const codeView = view('code', 'Check your email',
    h('span', null, 'We sent a 6-digit code to ', cdEmail, '. It works for 15 minutes.'),
    cd.code.wrap, cd.password.wrap, cd.msg, cd.submit,
    h('p', { class: 'auth-switch auth-row' }, cd.resend, h('button', { type: 'button', class: 'text-button', onclick: () => show(allowCreate ? 'create' : 'signin', { email: state.email }) }, 'Use a different email')),
    // No code is sent when the email already has an account (the server doesn't say so, to keep accounts private).
    h('p', { class: 'auth-aside' }, 'No code? If this email already has an account, ',
      h('button', { type: 'button', class: 'text-button', onclick: () => show('signin', { email: state.email }) }, 'sign in instead'), '.'));

  // ---- a new account confirmed, its password still to set ----
  const ch = { password: passwordField('choose-password', { label: 'Your password', fresh: true }), msg: region(), submit: submitButton('Save and continue') };
  const chooseView = view('choose', 'Choose your password',
    'Your email is confirmed. One last step: the password you will sign in with.',
    ch.password.wrap, ch.msg, ch.submit);

  // ---- forgot password ----
  const fg = { email: emailField('forgot-email'), msg: region(), submit: submitButton('Send me a code') };
  const forgotView = view('forgot', 'Reset your password',
    "Enter your account's email. If it has an account, we'll send a 6-digit code to it.",
    fg.email.wrap, fg.msg, fg.submit,
    h('p', { class: 'auth-switch' }, go('Back to sign in', 'signin')));

  // ---- the reset code and the new password ----
  const rsEmail = h('strong', { class: 'auth-email' });
  const rs = { code: codeField('reset-code'), password: passwordField('reset-password', { label: 'New password', fresh: true }), msg: region(), submit: submitButton('Save and sign in'), resend: h('button', { type: 'button', class: 'text-button' }, RESEND) };
  const accepted = h('p', { class: 'field-done', hidden: true }, star('field-star'), 'Code accepted');
  const resetView = view('reset', 'Choose a new password',
    h('span', null, 'If ', rsEmail, ' has an account, a 6-digit code is on its way. It works for 15 minutes.'),
    rs.code.wrap, accepted, rs.password.wrap, rs.msg, rs.submit,
    h('p', { class: 'auth-switch auth-row' }, rs.resend, go('Back to sign in', 'signin')));

  const views = { signin: signinView, create: createView, code: codeView, choose: chooseView, forgot: forgotView, reset: resetView };
  const messages = { signin: si.msg, create: cr.msg, code: cd.msg, choose: ch.msg, forgot: fg.msg, reset: rs.msg };
  const emails = { signin: si.email.input, create: cr.email.input, forgot: fg.email.input };
  root.replaceChildren(...Object.values(views));

  function emailNow() {
    const input = emails[state.view];
    return input ? input.value.trim() : state.email;
  }

  function show(name, { email, focus = true } = {}) {
    if (email !== undefined) state.email = email;
    if (emails[name] && state.email) emails[name].value = state.email;
    if (name === 'signin' || name === 'create' || name === 'forgot') {
      clearPending();
      state.recovery = null;
      state.password = '';
      state.fresh = null;
    }
    // The code step asks for a password only when this page doesn't hold the one chosen.
    cd.password.wrap.hidden = !!state.password;
    cdEmail.textContent = state.email;
    rsEmail.textContent = state.email;
    for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
    for (const m of Object.values(messages)) say(m, '');
    state.view = name;
    root.dataset.view = name;
    const el = views[name];
    el.classList.remove('view-in');
    void el.offsetWidth; // restart the entrance
    el.classList.add('view-in');
    if (focus) {
      const target = name === 'code' ? cd.code.input : name === 'choose' ? ch.password.input
        : name === 'reset' && !state.recovery ? rs.code.input : el.querySelector('.auth-title');
      target.focus({ preventScroll: false });
    }
    onView(name);
  }

  function sent(kind, email, retryAfter = 0) {
    const sentAt = retryAfter > 0 ? Date.now() - (RESEND_GAP - retryAfter * 1000) : Date.now();
    if (kind === 'signup') { try { sessionStorage.setItem(PENDING, JSON.stringify({ kind, email, sentAt })); } catch {} }
    waitUntil(kind === 'signup' ? cd.resend : rs.resend, sentAt + RESEND_GAP, RESEND);
  }
  function clearPending() {
    try { sessionStorage.removeItem(PENDING); } catch {}
  }
  function readPending() {
    try {
      const p = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
      if (p && p.kind === 'signup' && typeof p.email === 'string'
        && Number.isFinite(p.sentAt) && Date.now() - p.sentAt < CODE_LIFE) return p;
    } catch {}
    return null;
  }

  function done(how, extra = {}) {
    clearPending();
    state.recovery = null;
    state.password = '';
    state.fresh = null;
    for (const f of [si.password, cr.password, cd.password, ch.password, rs.password]) { f.input.value = ''; f.hide(); }
    cd.code.input.value = '';
    rs.code.input.value = '';
    rs.code.wrap.hidden = false; accepted.hidden = true; rs.resend.hidden = false;
    onSignedIn({ how, ...extra });
  }

  // A new account's email that was never confirmed: send a code and ask for it.
  async function confirmFirst(email, password) {
    state.password = password;
    show('code', { email });
    try {
      await account.resendSignUpCode(email);
      sent('signup', email);
      say(cd.msg, "This email isn't confirmed yet, so we sent it a new code. Enter it to finish.", 'info');
    } catch (err) {
      if (err.key === 'too_soon') {
        sent('signup', email, err.retryAfter);
        say(cd.msg, "This email isn't confirmed yet. A code went out moments ago: enter it to finish.", 'info');
      } else say(cd.msg, err.message);
    }
  }

  signinView.addEventListener('submit', (e) => {
    e.preventDefault();
    run(si.submit, async () => {
      const email = si.email.input.value.trim();
      const password = si.password.input.value;
      if (!EMAIL.test(email)) return invalid(si.email.input, si.msg, account.sentence('bad_email'));
      if (!password) return invalid(si.password.input, si.msg, 'Enter your password.');
      say(si.msg, '');
      state.email = email;
      try {
        await account.signIn(email, password);
        done('signin');
      } catch (err) {
        if (err.key === 'email_not_confirmed') return confirmFirst(email, password);
        if (err.key === 'invalid_credentials') return invalid(si.password.input, si.msg, err.message);
        say(si.msg, err.message);
      }
    });
  });

  createView.addEventListener('submit', (e) => {
    e.preventDefault();
    run(cr.submit, async () => {
      const email = cr.email.input.value.trim();
      const password = cr.password.input.value;
      if (!EMAIL.test(email)) return invalid(cr.email.input, cr.msg, account.sentence('bad_email'));
      if (!goodPassword(password)) return invalid(cr.password.input, cr.msg, account.sentence('weak_password'));
      say(cr.msg, '');
      state.email = email;
      try {
        const { session } = await account.signUp(email, password);
        if (session) { await account.setNewPassword(session, password); return done('signup'); }
        cr.password.input.value = '';
        state.password = password; // held here, in memory, until it's set after the code
        show('code', { email });
        sent('signup', email);
      } catch (err) {
        if (err.key === 'too_soon') { // an account waiting for its code: that code still works
          state.password = password;
          show('code', { email });
          sent('signup', email, err.retryAfter);
          return say(cd.msg, 'A code went out to this email moments ago. Enter it here.', 'info');
        }
        if (err.key === 'user_already_exists') {
          return say(cr.msg, err.message, 'error', { label: 'Sign in instead', run: () => show('signin', { email }) });
        }
        if (err.key === 'weak_password' || err.key === 'pwned_password') return invalid(cr.password.input, cr.msg, err.message);
        if (err.key === 'bad_email' || err.key === 'email_blocked') return invalid(cr.email.input, cr.msg, err.message);
        say(cr.msg, err.message);
      }
    });
  });

  // Six digits in (typed, pasted or filled in from Mail) and the code goes by itself,
  // unless a password is still to be chosen: then the cursor moves on to it.
  cd.code.input.addEventListener('input', () => {
    if (cd.code.input.value.length !== 6 || cd.submit.disabled) return;
    if (state.password || goodPassword(cd.password.input.value)) codeView.requestSubmit();
    else cd.password.input.focus();
  });

  // The code confirms the email and gives a session; the password is set with it straight
  // away (the server keeps no password from before the email was confirmed).
  codeView.addEventListener('submit', (e) => {
    e.preventDefault();
    run(cd.submit, async () => {
      const code = cd.code.input.value.trim();
      const password = state.password || cd.password.input.value;
      if (!/^\d{6}$/.test(code)) return invalid(cd.code.input, cd.msg, 'Enter the 6 digits from the email.');
      if (!goodPassword(password)) return invalid(cd.password.input, cd.msg, `Choose a password: ${PASSWORD_RULE.toLowerCase()}`);
      say(cd.msg, '');
      let session;
      try {
        session = await account.confirmSignUp(state.email, code);
      } catch (err) {
        if (err.key === 'code_invalid') return invalid(cd.code.input, cd.msg, err.message);
        return say(cd.msg, err.message);
      }
      await savePassword(session, password);
    });
  });

  async function savePassword(session, password) {
    try {
      await account.setNewPassword(session, password);
      done('signup');
    } catch (err) {
      state.fresh = err.session || session;
      state.password = '';
      clearPending(); // the code is spent; a reload from here would need "Forgot your password?"
      if (state.view !== 'choose') show('choose');
      if (err.key === 'weak_password' || err.key === 'pwned_password') return invalid(ch.password.input, ch.msg, err.message);
      if (err.key === 'signed_out') {
        state.fresh = null;
        return say(ch.msg, "That took a while, so this step ran out. Your email is confirmed: set a password with \"Forgot your password?\"", 'error',
          { label: 'Set it now', run: () => show('forgot', { email: state.email }) });
      }
      say(ch.msg, `Your email is confirmed, but the password didn't save. ${err.message}`);
    }
  }

  chooseView.addEventListener('submit', (e) => {
    e.preventDefault();
    run(ch.submit, async () => {
      const password = ch.password.input.value;
      if (!goodPassword(password)) return invalid(ch.password.input, ch.msg, account.sentence('weak_password'));
      if (!state.fresh) return say(ch.msg, 'This step ran out. Set your password with "Forgot your password?"', 'error', { label: 'Set it now', run: () => show('forgot', { email: state.email }) });
      say(ch.msg, '');
      await savePassword(state.fresh, password);
    });
  });

  cd.resend.addEventListener('click', () => run(cd.resend, async () => {
    try {
      await account.resendSignUpCode(state.email);
      sent('signup', state.email);
      say(cd.msg, 'Sent. Use the code in the newest email.', 'ok');
    } catch (err) {
      if (err.key === 'too_soon') sent('signup', state.email, err.retryAfter);
      say(cd.msg, err.message);
    }
    cd.code.input.focus();
  }));

  forgotView.addEventListener('submit', (e) => {
    e.preventDefault();
    run(fg.submit, async () => {
      const email = fg.email.input.value.trim();
      if (!EMAIL.test(email)) return invalid(fg.email.input, fg.msg, account.sentence('bad_email'));
      say(fg.msg, '');
      try {
        await account.sendResetCode(email);
        show('reset', { email });
        sent('recovery', email);
      } catch (err) {
        if (err.key === 'too_soon') {
          show('reset', { email });
          sent('recovery', email, err.retryAfter);
          return say(rs.msg, 'A code went out moments ago. Enter it here, or send another when the wait is over.', 'info');
        }
        say(fg.msg, err.message);
      }
    });
  });

  resetView.addEventListener('submit', (e) => {
    e.preventDefault();
    run(rs.submit, async () => {
      const code = rs.code.input.value.trim();
      const password = rs.password.input.value;
      if (!state.recovery && !/^\d{6}$/.test(code)) return invalid(rs.code.input, rs.msg, 'Enter the 6 digits from the email.');
      if (!goodPassword(password)) return invalid(rs.password.input, rs.msg, account.sentence('weak_password'));
      say(rs.msg, '');
      try {
        if (!state.recovery) {
          state.recovery = await account.confirmResetCode(state.email, code);
          // The code is spent now; if the password needs another try, only it is asked for.
          rs.code.wrap.hidden = true;
          accepted.hidden = false;
          rs.resend.hidden = true;
        }
        const { changed } = await account.setNewPassword(state.recovery, password);
        done('reset', { changed });
      } catch (err) {
        if (err.session) state.recovery = err.session; // the newest copy, for the next try
        if (err.key === 'code_invalid') return invalid(rs.code.input, rs.msg, err.message);
        if (err.key === 'weak_password' || err.key === 'pwned_password') return invalid(rs.password.input, rs.msg, err.message);
        if (err.key === 'signed_out' && state.recovery) {
          // The reset session ran out before the password was saved: start again with a new code.
          state.recovery = null;
          rs.code.wrap.hidden = false; accepted.hidden = true; rs.resend.hidden = false;
          rs.code.input.value = '';
          return say(rs.msg, 'That took a while, so the code ran out. Send a new code and try again.');
        }
        say(rs.msg, err.message);
      }
    });
  });

  rs.resend.addEventListener('click', () => run(rs.resend, async () => {
    try {
      await account.sendResetCode(state.email);
      sent('recovery', state.email);
      say(rs.msg, 'Sent. Use the code in the newest email.', 'ok');
    } catch (err) {
      if (err.key === 'too_soon') sent('recovery', state.email, err.retryAfter);
      say(rs.msg, err.message);
    }
    rs.code.input.focus();
  }));

  // Back at the code step if the page reloaded while a new account waited for it.
  const pending = readPending();
  if (pending) {
    state.email = pending.email;
    show('code', { focus: false });
    waitUntil(cd.resend, pending.sentAt + RESEND_GAP, RESEND);
  } else {
    show(start, { focus: false });
  }

  return {
    show,
    get view() { return state.view; },
    notice(text, tone = 'info') { say(messages[state.view], text, tone); },
    /** Back to the first form with nothing filled in. */
    reset(to = start) {
      for (const input of root.querySelectorAll('input')) { input.value = ''; input.removeAttribute('aria-invalid'); }
      state.email = '';
      state.recovery = null;
      state.password = '';
      state.fresh = null;
      rs.code.wrap.hidden = false; accepted.hidden = true; rs.resend.hidden = false;
      show(to, { focus: false });
    },
  };
}
