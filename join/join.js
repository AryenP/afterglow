// An invite: make an account (or sign in), enter the emailed code, and the
// invite's days go onto the account. The code arrives after the # in the link;
// boot.js has already taken it out of the address bar and holds it in this
// tab's sessionStorage, until it's used or turns out not to work.

import * as account from '../account/afterglow-account.js';
import { $, say, run, mountAuth, framed, testBuild, longDay, count } from '../account/ui.js';

const KEY = 'afterglow-invite';
const el = {
  invite: $('#invite'), missing: $('#missing'), stage: $('#stage'),
  steps: $('#steps'), stepDays: $('#step-days'),
  auth: $('#join-auth'),
  confirm: $('#join-confirm'), confirmTitle: $('#confirm-title'), confirmEmail: $('#confirm-email'), confirmMsg: $('#confirm-msg'),
  confirmUse: $('#confirm-use'), confirmSwitch: $('#confirm-switch'),
  working: $('#join-working'), workingTitle: $('#working-title'),
  done: $('#join-done'), doneTitle: $('#done-title'), doneDays: $('#done-days'), doneUntil: $('#done-until'),
  doneBuild: $('#done-build'), doneEmail: $('#done-email'),
  problem: $('#join-problem'), problemTitle: $('#problem-title'), problemText: $('#problem-text'),
};

let code = '';
let auth;

/** The invite's code. On arrival boot.js has already moved it from the address bar into this
 *  tab's storage; a link opened later in the same tab arrives as a new # (no reload), and wins. */
function takeCode() {
  let raw = '';
  if (location.hash.length > 1) {
    raw = location.hash.slice(1);
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (!raw) { try { raw = sessionStorage.getItem(KEY) || ''; } catch {} }
  if (!raw && typeof window.afterglowInvite === 'string') { raw = window.afterglowInvite; delete window.afterglowInvite; }
  try { raw = decodeURIComponent(raw); } catch {}
  // A whole link pasted, or a messenger's trailing full stop: keep only the code itself.
  const clean = raw.trim().replace(/^.*[#/]/, '').replace(/[^A-Za-z0-9_-]+$/, '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(clean)) { forget(); return ''; }
  try { sessionStorage.setItem(KEY, clean); } catch {}
  return clean;
}

function forget() {
  code = '';
  try { sessionStorage.removeItem(KEY); } catch {}
}

function start() {
  el.confirmUse.addEventListener('click', () => run(el.confirmUse, redeem));
  el.confirmSwitch.addEventListener('click', () => run(el.confirmSwitch, async () => {
    await account.signOut();
    showAuth('create');
  }));
  addEventListener('hashchange', () => { if (location.hash.length > 1) begin(); });
  begin();
}

/** Starts (or starts over) with whatever invite this tab holds. */
function begin() {
  code = takeCode();
  el.missing.hidden = !!code;
  el.invite.hidden = !code;
  el.stage.classList.remove('is-lit');
  el.stepDays.textContent = '30 days';
  if (!code) return;
  auth ??= mountAuth(el.auth, {
    start: 'create',
    copy: {
      createTitle: 'Make your account',
      createText: "Your email and a password. We'll email you a 6-digit code to confirm it's yours.",
      createButton: 'Make my account',
      signinTitle: 'Sign in',
      signinText: 'Sign in, and the days go onto your account.',
      createPrompt: 'New here?',
    },
    onView: (name) => { if (!el.auth.hidden) step(name === 'code' ? 'code' : 'account'); },
    onSignedIn: () => redeem(),
  });
  if (account.signedInUser()) showConfirm();
  else showAuth();
}

// ---------- which panel shows, and how far along the stars are ----------
function only(panel) {
  for (const p of [el.auth, el.confirm, el.working, el.done, el.problem]) p.hidden = p !== panel;
}

const ORDER = ['account', 'code', 'days'];
function step(current) {
  const at = current === 'finished' ? 3 : ORDER.indexOf(current);
  el.steps.style.setProperty('--at', String(Math.min(at, 2) / 2));
  el.steps.querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('is-done', i < at);
    if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

function showAuth(view) {
  only(el.auth);
  if (view) auth.show(view, { focus: false });
  step(auth.view === 'code' ? 'code' : 'account');
}

function showConfirm(message) {
  only(el.confirm);
  step('days');
  el.confirmEmail.textContent = account.signedInUser()?.email || '';
  say(el.confirmMsg, message || '');
}

function problem(title, text) {
  only(el.problem);
  step('days');
  el.problemTitle.textContent = title;
  el.problemText.textContent = text;
  el.problemTitle.focus();
}

// ---------- using the invite ----------
async function redeem() {
  if (!code) return problem('This invite was already used here', 'Its days are on your account. Open your account to see them.');
  only(el.working);
  step('days');
  el.workingTitle.focus();
  try {
    const r = await account.redeemInvite(code);
    forget();
    finished(r);
  } catch (err) {
    switch (err.key) {
      case 'invalid_or_used':
        forget();
        return problem("This invite doesn't work anymore",
          "It may have been used already, revoked, or it ran out. Ask the person who sent it for a new link. Your account is ready either way.");
      case 'too_many_attempts':
        return problem('Too many tries for now',
          'This account tried too many wrong invite codes in the last hour. Wait an hour, then open your invite link again.');
      case 'email_not_confirmed_invite':
        only(el.auth);
        auth.show('code', { email: account.signedInUser()?.email || '' });
        return auth.notice('Confirm your email first: send yourself a code, then enter it here. The invite is used straight after.');
      case 'signed_out':
        showAuth('signin');
        return auth.notice(err.message);
      default:
        return showConfirm(err.message);
    }
  }
}

function finished(r) {
  only(el.done);
  step('finished');
  const days = count(Number(r.days_added) || 0, 'day', 'days');
  el.doneDays.textContent = days;
  el.stepDays.textContent = days;
  el.doneUntil.textContent = `Free until ${longDay(r.invite_until)}. Nothing to pay, and nothing renews.`;
  el.doneEmail.textContent = account.signedInUser()?.email || 'your new account';
  el.stage.classList.add('is-lit');
  el.doneTitle.focus();
  testBuild().then((found) => {
    if (!found) return;
    el.doneBuild.href = found.url;
    el.doneBuild.hidden = false;
  });
}

// Last, so every constant above exists before anything runs.
if (!framed()) start();
