// Afterglow accounts, for the website: the one client for supabase/ACCOUNTS.md.
// A plain ES module with no dependencies. It never logs anything, and never
// puts a password, a code or a token in a URL: they only travel in request
// bodies and the Authorization header.
//
// The session lives in this page's memory only, never in localStorage or
// sessionStorage: aryenp.github.io is one origin shared with Aryen's other
// GitHub Pages projects, and any of them could read what this site stores
// there. So a reload or a new page means signing in again.

// ---------- which server ----------
// Only the page's own host decides, never a query string or a hash: the site
// on GitHub Pages talks to production, a copy served on this Mac to the local
// test stack.
const PRODUCTION = Object.freeze({
  url: 'https://pkiblvyhhzzajhjlnjjh.supabase.co',
  // The publishable key, as in Sources/Afterglow/Lyrics/SharedTiming.swift.
  // Public by design: row-level security and the functions protect the data.
  key: 'sb_publishable_lbpEdXsCGfBqeKmG38ZsJg_LQ38qthd',
});
const LOCAL = Object.freeze({
  url: 'http://127.0.0.1:54321',
  // The local stack's anon key (`supabase status -o env`, ANON_KEY).
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
});
export const isLocal = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
export const server = isLocal ? LOCAL : PRODUCTION;

// An early build kept the session in localStorage; make sure nothing is left there.
try { localStorage.removeItem('afterglow-account'); } catch {}

// ---------- errors: a key, and a plain sentence that says what to do next ----------
const SENTENCES = {
  offline: "Can't reach Afterglow right now. Check your connection, then try again.",
  server: 'Something went wrong on our side. Try again in a minute.',
  unknown: "That didn't work. Try again in a minute.",
  signed_out: "You've been signed out. Sign in again to carry on.",
  invalid_credentials: "That email and password don't match. Check both, or reset your password.",
  email_not_confirmed: "This email isn't confirmed yet. Enter the code we email you to finish.",
  user_already_exists: "There's already an account with this email. Sign in instead, or reset your password.",
  weak_password: 'Use at least 8 characters, with letters and numbers.',
  pwned_password: 'That password has shown up in a data leak elsewhere. Choose another one.',
  same_password: "That's already your password.",
  bad_email: 'Enter your whole email address, like name@example.com.',
  bad_input: 'Check what you typed, then try again.',
  email_blocked: "Afterglow can't send email to that address. Try another one.",
  code_invalid: 'That code is wrong or has run out. Check the newest email, or send a new code.',
  too_soon: 'A code went out moments ago. Check your email, or send another in a minute.',
  rate_limited: 'Too many tries for now. Wait a few minutes, then try again.',
  signups_closed: 'New accounts are paused for now. Try again later.',
  reauthenticate: 'For safety, sign in again before changing your password.',
  reauth_needed: 'For your safety, enter your password again.',
  wrong_current_password: "That isn't your current password. Check it, or sign out and reset it.",
  not_owner: "Only Afterglow's owner can do that.",
  bad_count: 'Make between 1 and 50 links at a time.',
  bad_days: 'Choose between 1 and 90 days.',
  note_too_long: 'Keep the note to 80 characters.',
  invalid_or_used: "That invite doesn't work. It may be mistyped, used, revoked or expired. Ask for a new one.",
  too_many_attempts: 'Too many wrong invite codes in the last hour. Wait an hour, then try again.',
  email_not_confirmed_invite: 'Confirm your email first, then use the invite.',
  payments_not_ready: 'Memberships open soon. Until then, an invite gives you 30 days free.',
  no_membership: "There's no membership on this account yet.",
};

export class AccountError extends Error {
  constructor(key, { status = 0, retryAfter = 0 } = {}) {
    const known = Object.hasOwn(SENTENCES, key) ? key : 'unknown';
    super(known === 'too_soon' && retryAfter > 0
      ? `A code went out moments ago. You can send another in ${retryAfter} seconds.`
      : SENTENCES[known]);
    this.name = 'AccountError';
    this.key = known;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** The plain sentence for a key, for pages that show one without an error. */
export const sentence = (key) => SENTENCES[key] || SENTENCES.unknown;

const SIGNED_OUT = new Set(['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used',
  'bad_jwt', 'session_expired', 'no_authorization', 'not_signed_in']);

function failure(r, where) {
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  const code = String(d.error_code || (typeof d.error === 'string' ? d.error : '') || '');
  const text = String(d.msg || d.error_description || d.message || '');
  const opts = { status: r.status };
  if (r.status === 0) return new AccountError('offline', opts);
  // Database functions answer with their key in `message`; Edge Functions in `error`.
  if (where === 'rpc') {
    if (Object.hasOwn(SENTENCES, d.message)) return new AccountError(d.message, opts);
    if (r.status === 401 || d.code === 'PGRST301' || d.message === 'not_signed_in') return new AccountError('signed_out', opts);
  }
  if (SIGNED_OUT.has(code)) return new AccountError('signed_out', opts);
  switch (code) {
    case 'invalid_credentials':
      return new AccountError('invalid_credentials', opts);
    case 'invalid_grant': // older servers say it in words
      return new AccountError(/confirm/i.test(text) ? 'email_not_confirmed' : 'invalid_credentials', opts);
    case 'email_not_confirmed':
      return new AccountError('email_not_confirmed', opts);
    case 'user_already_exists': case 'email_exists':
      return new AccountError('user_already_exists', opts);
    case 'weak_password': {
      const reasons = Array.isArray(d.weak_password?.reasons) ? d.weak_password.reasons : [];
      return new AccountError(reasons.includes('pwned') ? 'pwned_password' : 'weak_password', opts);
    }
    case 'same_password':
      return new AccountError('same_password', opts);
    case 'email_address_invalid': case 'email_address_not_authorized':
      return new AccountError('email_blocked', opts);
    case 'otp_expired': case 'otp_invalid':
      return new AccountError('code_invalid', opts);
    case 'user_not_found':
      return new AccountError(where === 'code' ? 'code_invalid' : 'signed_out', opts);
    case 'over_email_send_rate_limit': {
      const seconds = Number((text.match(/(\d+)\s*seconds?/i) || [])[1]) || 0;
      return new AccountError('too_soon', { ...opts, retryAfter: seconds });
    }
    case 'over_request_rate_limit': case 'over_sms_send_rate_limit':
      return new AccountError('rate_limited', opts);
    case 'signup_disabled': case 'email_provider_disabled':
      return new AccountError('signups_closed', opts);
    case 'reauthentication_needed': case 'reauthentication_not_valid':
      return new AccountError('reauthenticate', opts);
    case 'validation_failed':
      return new AccountError(/email/i.test(text) ? 'bad_email' : /password/i.test(text) ? 'weak_password' : 'bad_input', opts);
  }
  if (Object.hasOwn(SENTENCES, code)) return new AccountError(code, opts); // payments_not_ready, reauth_needed…
  if (where === 'code' && (r.status === 403 || r.status === 404)) return new AccountError('code_invalid', opts);
  if (r.status === 429) return new AccountError('rate_limited', opts);
  if (r.status === 401) return new AccountError('signed_out', opts);
  if (r.status >= 500) return new AccountError('server', opts);
  return new AccountError('unknown', opts);
}

// ---------- requests ----------
function deadline(ms) {
  if (AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** One request to the server. Resolves to {status, ok, data}; status 0 when it never arrived. */
async function send(path, { method = 'POST', body, token, timeout = 20000 } = {}) {
  const headers = { apikey: server.key };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(server.url + path, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: deadline(timeout),
    });
  } catch {
    return { status: 0, ok: false, data: null };
  }
  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

// ---------- the session: in this page's memory, and nowhere else ----------
const EARLY = 90; // refresh this many seconds before the access token runs out
const now = () => Date.now() / 1000;
let current = null;

function sessionFrom(data, previous) {
  if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') return null;
  const life = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
  const user = data.user && typeof data.user === 'object' ? data.user : previous?.user || {};
  return Object.freeze({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    // Timed by this computer's own clock, so one that runs fast or slow still refreshes in time.
    expires_at: Math.floor(now()) + life,
    user: Object.freeze({ id: String(user.id || ''), email: String(user.email || '') }),
  });
}

function keep(s) {
  current = s;
  schedule();
  return s;
}

const listeners = new Set();
/** Called with null when this page finds itself signed out (an ended session, a spent token). */
export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function drop() {
  const was = current;
  current = null;
  clearTimeout(timer);
  if (was) for (const fn of listeners) { try { fn(null); } catch {} }
}

/** A fresher copy of `s`. Refresh tokens rotate: each refresh spends the old one, so only the
 *  newest is ever kept, and one refresh at a time runs (a second caller shares the first's). */
const refreshing = new Map();
function renew(s) {
  if (!refreshing.has(s.refresh_token)) {
    refreshing.set(s.refresh_token, (async () => {
      const r = await send('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } });
      const fresh = r.ok ? sessionFrom(r.data, s) : null;
      if (fresh) return fresh;
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new AccountError('signed_out', { status: r.status });
      throw failure(r, 'auth'); // offline or busy: the session stands, try again later
    })().finally(() => refreshing.delete(s.refresh_token)));
  }
  return refreshing.get(s.refresh_token);
}

/** The page's session, refreshed (`force`: even if the clock says it's still good). */
async function refresh({ force = false } = {}) {
  const s = current;
  if (!s) return null;
  if (!force && s.expires_at - now() > EARLY) return s;
  try {
    const fresh = await renew(s);
    if (current === s) keep(fresh);
    return current;
  } catch (err) {
    if (err.key === 'signed_out' && current === s) drop();
    throw err;
  }
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  if (!current) return;
  const wait = Math.max(5, current.expires_at - now() - EARLY);
  timer = setTimeout(() => {
    refresh({ force: true }).catch((err) => { if (err.key !== 'signed_out') timer = setTimeout(schedule, 30000); });
  }, Math.min(wait * 1000, 2 ** 31 - 1));
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current) refresh().catch(() => {});
});

/** Who is signed in on this page: {id, email}, or null. */
export function signedInUser() {
  return current?.user || null;
}

/** A session with an access token good for at least a minute and a half, or null when signed out. */
export async function getSession() {
  return current ? refresh() : null;
}

async function authed(path, body, timeout) {
  let s = await getSession();
  if (!s) throw new AccountError('signed_out');
  let r = await send(path, { body, token: s.access_token, timeout });
  // reauth_needed asks for a fresh sign-in; refreshing can't give one.
  if (r.status === 401 && r.data?.error !== 'reauth_needed') {
    s = await refresh({ force: true });
    if (!s) throw new AccountError('signed_out');
    r = await send(path, { body, token: s.access_token, timeout });
    if (r.status === 401 && r.data?.error !== 'reauth_needed') { drop(); throw new AccountError('signed_out', { status: 401 }); }
  }
  return r;
}

// ---------- accounts (Supabase Auth) ----------
/** Makes an account. A 6-digit code is emailed; there is no session until it is entered,
 *  and the password only counts once it's set again after the code (setNewPassword). */
export async function signUp(email, password) {
  const r = await send('/auth/v1/signup', { body: { email, password } });
  if (!r.ok) throw failure(r, 'auth');
  return { session: sessionFrom(r.data) }; // only if the project ever stops asking for the code
}

/** The emailed code confirms the address and returns a session. Not kept yet: the page sets
 *  the password with it first (the server drops any password set before the email was confirmed). */
export async function confirmSignUp(email, code) {
  const r = await send('/auth/v1/verify', { body: { type: 'signup', email, token: code } });
  const s = r.ok ? sessionFrom(r.data) : null;
  if (!s) throw failure(r, 'code');
  return s;
}

export async function resendSignUpCode(email) {
  const r = await send('/auth/v1/resend', { body: { type: 'signup', email } });
  if (!r.ok) throw failure(r, 'auth');
}

/** A new session from the email and password, without making it this page's session yet. */
async function freshSession(email, password) {
  const r = await send('/auth/v1/token?grant_type=password', { body: { email, password } });
  const s = r.ok ? sessionFrom(r.data) : null;
  if (!s) throw failure(r, 'auth');
  return s;
}

/** The signed-in person's password, checked by signing in with it: a fresh session. */
async function checkPassword(email, password) {
  try {
    return await freshSession(email, password);
  } catch (err) {
    throw err.key === 'invalid_credentials' ? new AccountError('wrong_current_password', { status: err.status }) : err;
  }
}

export async function signIn(email, password) {
  return keep(await freshSession(email, password));
}

/** Emails a reset code if the address has an account. Answers the same either way. */
export async function sendResetCode(email) {
  const r = await send('/auth/v1/recover', { body: { email } });
  if (!r.ok) throw failure(r, 'auth');
}

/** Checks a reset code. The session it returns is held by the page until the new password is set. */
export async function confirmResetCode(email, code) {
  const r = await send('/auth/v1/verify', { body: { type: 'recovery', email, token: code } });
  const s = r.ok ? sessionFrom(r.data) : null;
  if (!s) throw failure(r, 'code');
  return s;
}

/** Sets the password with the session a code gave (a new account's, or a reset's), then makes
 *  that session this page's: signed in. The same password as before counts as set.
 *  Returns {changed, session}; on any other answer it throws and keeps nothing, so the page
 *  can hold on to `session` and ask again. */
export async function setNewPassword(session, password) {
  let s = session;
  let r = await send('/auth/v1/user', { method: 'PUT', body: { password }, token: s.access_token });
  if (r.status === 401) { // an hour went by on this step: renew the code's session once
    s = await renew(s);
    r = await send('/auth/v1/user', { method: 'PUT', body: { password }, token: s.access_token });
  }
  if (r.ok) { keep(s); return { changed: true, session: s }; }
  const err = failure(r, 'auth');
  if (err.key === 'same_password') { keep(s); return { changed: false, session: s }; }
  err.session = s; // the newest copy, for the page to retry with
  throw err;
}

/** Changes the password: signs in with the current one for a fresh session, sets the new one
 *  with it, and keeps that session. The server signs out every other session (other browsers,
 *  the Mac app) when a password changes. */
export async function changePassword(currentPassword, newPassword) {
  const email = current?.user.email;
  if (!email) throw new AccountError('signed_out');
  const fresh = await checkPassword(email, currentPassword);
  const r = await send('/auth/v1/user', { method: 'PUT', body: { password: newPassword }, token: fresh.access_token });
  if (r.ok) { keep(fresh); return true; }
  send('/auth/v1/logout?scope=local', { token: fresh.access_token, timeout: 8000 }); // don't leave it lying around
  throw failure(r, 'auth');
}

/** Signs this page out (only this one: the Mac app and other browsers stay signed in). */
export async function signOut() {
  if (current) {
    let s = current;
    try { s = (await refresh()) || s; } catch {}
    await send('/auth/v1/logout?scope=local', { token: s.access_token, timeout: 8000 });
  }
  drop();
}

// ---------- membership and invites (database functions) ----------
export async function rpc(name, args = {}) {
  const r = await authed(`/rest/v1/rpc/${encodeURIComponent(name)}`, args);
  if (r.ok) return r.data;
  const err = failure(r, 'rpc');
  if (err.key === 'signed_out') drop(); // a session that ended elsewhere (signed out, or a new password)
  throw err;
}

export const myAccess = () => rpc('my_access');

/** Accepts the bare code or a whole link. */
export async function redeemInvite(code) {
  const r = await rpc('redeem_invite', { code: String(code) });
  if (r && r.ok === true) return r;
  const key = r && typeof r.error === 'string' ? r.error : 'server';
  throw new AccountError(key === 'email_not_confirmed' ? 'email_not_confirmed_invite' : key);
}

export const createInvites = ({ howMany = 1, note = null, days = 30 } = {}) =>
  rpc('create_invites', { how_many: howMany, note: note || null, days });
export const listInvites = () => rpc('list_invites');
export const revokeInvite = (id) => rpc('revoke_invite', { invite_id: id });

// ---------- payments and deleting (Edge Functions) ----------
// A function that hasn't run for a while takes a few seconds to wake: wait longer for these.
const FUNCTION_WAIT = 45000;

export async function callFunction(name, body = {}) {
  const r = await authed(`/functions/v1/${encodeURIComponent(name)}`, body, FUNCTION_WAIT);
  if (r.ok) return r.data || {};
  const err = failure(r, 'function');
  if (err.key === 'signed_out') drop();
  throw err;
}

export const startCheckout = () => callFunction('billing-checkout');
export const openBillingPortal = () => callFunction('billing-portal');

/** Deletes the account: signs in with the password first (the server wants a sign-in from the
 *  last few minutes), then ends any membership at Stripe and deletes everything stored for it. */
export async function deleteAccount(password) {
  const email = current?.user.email;
  if (!email) throw new AccountError('signed_out');
  const fresh = keep(await checkPassword(email, password));
  const r = await send('/functions/v1/account-delete', { body: {}, token: fresh.access_token, timeout: FUNCTION_WAIT });
  if (r.ok && r.data?.deleted) { drop(); return true; }
  throw failure(r, 'function');
}
