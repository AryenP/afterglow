// Your Afterglow account, in two parts. Membership: what you have, where you are
// on the price ladder, joining, billing, invites and the test build. Account:
// your email, password, signing out and deleting. Everything that comes from the
// server is set as text. The session lives in this page's memory only.

import * as account from './afterglow-account.js';
import { $, h, star, say, invalid, run, LEAVING, mountAuth, framed, testBuild, openStripe, passwordToggles,
  goodPassword, shortDay, money, daysUntil, inFuture, count, sleep } from './ui.js';

/** Stripe still counts the membership as paid for these (as the server does). */
const LIVE = new Set(['active', 'trialing', 'past_due']);
const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

const el = {
  out: $('#signed-out'), in: $('#signed-in'), deleted: $('#deleted'), deletedTitle: $('#deleted-title'),
  title: $('#acct-title'), email: $('#me-email'), notice: $('#acct-notice'),
  pass: $('#pass'), status: $('#pass-status'), note: $('#pass-note'), passMsg: $('#pass-msg'),
  join: $('#join'), manage: $('#manage'), build: $('#build'), buildVersion: $('#build-version'),
  ladder: $('#ladder'), steps: $('#ladder-steps'), line: $('#ladder-line'), tail: $('#ladder-tail'),
  ladderText: $('#ladder-text'), again: $('#ladder-again'),
  redeem: $('#redeem'), code: $('#invite-code'), redeemButton: $('#redeem-button'), redeemMsg: $('#redeem-msg'),
  settings: $('#settings'), setEmail: $('#set-email'), ownerSetting: $('#owner-setting'),
  pwOpen: $('#pw-open'), pwForm: $('#pw-form'), pwUser: $('#pw-username'), pwCurrent: $('#pw-current'), pwNew: $('#pw-new'),
  pwMsg: $('#pw-msg'), pwSave: $('#pw-save'), pwCancel: $('#pw-cancel'), pwDone: $('#pw-done'),
  signOut: $('#sign-out'), deleteOpen: $('#delete-open'), deletePanel: $('#delete-panel'), deleteUser: $('#delete-username'),
  deletePassword: $('#delete-password'), deleteButton: $('#delete-button'), deleteCancel: $('#delete-cancel'), deleteMsg: $('#delete-msg'),
};

let me = null; // the latest my_access()
let who = ''; // the signed-in account's id, while this page shows it
let welcoming = false; // back from Stripe, until the welcome has run once
let auth;

function start() {
  // Back from Stripe's checkout: remembered here, and taken out of the address bar.
  const params = new URLSearchParams(location.search);
  welcoming = params.get('joined') === '1';
  if (params.has('joined')) history.replaceState(null, '', location.pathname);

  auth = mountAuth($('#auth'), {
    start: 'signin',
    onSignedIn: ({ how, changed }) => {
      enter();
      if (how === 'reset') note(changed ? 'Your new password is saved.' : "That's already your password, so it stays as it is.");
      else if (how === 'signup') note('Your account is ready.');
    },
  });
  // Signed out from here on (an ended session, a spent token): back to the form.
  account.onSessionChange((s) => { if (!s && who) leave("You've been signed out. Sign in again to carry on."); });

  el.out.hidden = false; // the session lives in memory, so every visit starts signed out
  if (welcoming && auth.view === 'signin') auth.notice('Thank you for joining. Sign in to see your membership.', 'info');
  passwordToggles(el.settings);
  wire();
}

function note(text, tone = 'ok') {
  say(el.notice, text, tone);
}

// ---------- signed in, signed out ----------
async function enter() {
  const user = account.signedInUser();
  if (!user) return leave();
  who = user.id;
  el.out.hidden = true;
  el.deleted.hidden = true;
  el.in.hidden = false;
  showEmail(user.email);
  closePassword();
  closeDelete();
  for (const m of [el.notice, el.passMsg, el.redeemMsg, el.pwDone]) say(m, '');
  testBuild().then(showBuild);
  if (welcoming) { welcoming = false; return welcome(); }
  await load();
}

function showEmail(email) {
  el.email.textContent = email;
  el.setEmail.textContent = email;
  el.pwUser.value = email; // for password managers, so the new password is saved to the right account
  el.deleteUser.value = email;
}

function leave(message) {
  who = '';
  me = null;
  el.in.hidden = true;
  el.in.classList.remove('is-welcome');
  el.title.textContent = 'Your account';
  el.deleted.hidden = true;
  el.out.hidden = false;
  closePassword();
  closeDelete();
  auth.reset('signin');
  if (message) auth.notice(message, 'info');
}

async function load() {
  setState('loading', 'Looking it up');
  try {
    me = await account.myAccess();
    render();
    return true;
  } catch (err) {
    if (err.key === 'signed_out') { leave(err.message); return false; }
    setState('error', "Can't show your membership right now");
    say(el.passMsg, err.message, 'error', { label: 'Try again', run: () => load() });
    return false;
  }
}

// ---------- the membership card ----------
function setState(state, line, p = 0) {
  el.pass.dataset.state = state;
  el.pass.style.setProperty('--p', String(p));
  if (line !== undefined) {
    el.status.replaceChildren(h('span', { class: 'pass-kind' }, 'Membership'), h('span', { class: 'visually-hidden' }, ': '),
      h('span', { class: 'pass-unit' }, line));
    el.note.replaceChildren();
    el.join.hidden = true;
    el.manage.hidden = true;
  }
}

function prices() {
  const list = Array.isArray(me?.prices_cents) ? me.prices_cents.filter((c) => Number.isFinite(c) && c >= 0) : [];
  return list.length ? list : null;
}

const isMember = (m) => !!m?.paid && LIVE.has(m.paid.status);

/** What the card says. Its heading reads, for example, "Invited: 21 days left, until Dec 5". */
function describe() {
  const ladder = prices() || [0];
  const paid = me.paid && typeof me.paid === 'object' ? me.paid : null;
  const days = daysUntil(me.access_until);
  const left = days === 1 ? 'day left' : 'days left';
  // Invite days count down underneath a paid membership too.
  const inviteDays = inFuture(me.invite_until) && me.source === 'paid'
    ? ` You also have invite days until ${shortDay(me.invite_until)}.` : '';
  // The owner always has access (the server renews it on every call): never a count of days.
  if (me.source === 'owner') {
    return { state: 'member', p: 1, kind: 'Membership', unit: 'Owner',
      note: [`Everything is on for this account, with nothing to pay and nothing running out.${paid ? ' Billing is still here for the membership on file.' : ''}`] };
  }
  if (paid && LIVE.has(paid.status)) {
    if (paid.status === 'past_due') {
      return { state: 'member', p: 1, kind: 'Member', unit: "Your last payment didn't go through",
        note: [`Update your card in Manage billing to keep it. Afterglow keeps working until ${shortDay(me.access_until)}.${inviteDays}`] };
    }
    if (paid.cancel_at_period_end) {
      return { state: 'member', p: 1, kind: 'Member', figure: String(days), unit: left, when: `until ${shortDay(me.access_until)}`,
        note: [`Ends on ${shortDay(paid.renews_at)}: it won't renew. Join again any time, and it starts over at ${money(ladder[0])}.${inviteDays}`] };
    }
    const step = Math.min(Math.max(Number(paid.months_in_a_row) || 0, 0), ladder.length - 1);
    const next = Number.isFinite(paid.next_price_cents) ? paid.next_price_cents : ladder[step];
    const months = Number(paid.months_in_a_row) || 0;
    return { state: 'member', p: 1, kind: 'Member', figure: money(next), unit: 'next month', when: `renews ${shortDay(paid.renews_at)}`,
      note: [`${months > 0 ? `${count(months, 'month', 'months')} in a row so far. Thank you.` : 'Thank you for joining.'}${inviteDays}`] };
  }
  if (inFuture(me.access_until)) {
    const invite = me.source !== 'paid';
    return { state: invite ? 'invite' : 'member', p: Math.max(0.04, Math.min(1, days / 30)), kind: invite ? 'Invited' : 'Member',
      figure: String(days), unit: left, when: `until ${shortDay(me.access_until)}`,
      note: [invite ? 'Free, from an invite: nothing to pay, and nothing renews.' : ''] };
  }
  const ended = paid ? 'Your membership has ended. ' : me.invite_until ? `Your invite days ended ${shortDay(me.invite_until)}. ` : '';
  if (!me.payments_ready) {
    return { state: 'none', p: 0, unit: 'Not a member yet',
      note: [`${ended}${account.sentence('payments_not_ready')} `, h('button', { type: 'button', class: 'text-button', onclick: focusInvite }, 'Use an invite')] };
  }
  return { state: 'none', p: 0, unit: 'Not a member yet', note: [`${ended}Become a member, or use an invite from a friend.`] };
}

function render() {
  const d = describe();
  if (me.email) showEmail(me.email);
  setState(d.state, undefined, d.p);
  el.status.replaceChildren(...[
    d.kind && h('span', { class: 'pass-kind' }, d.kind),
    d.kind && h('span', { class: 'visually-hidden' }, ': '),
    d.figure && h('span', { class: 'pass-figure' }, d.figure),
    d.figure && h('span', { class: 'visually-hidden' }, ' '),
    h('span', { class: 'pass-unit' }, d.unit),
    d.when && h('span', { class: 'visually-hidden' }, ', '),
    d.when && h('span', { class: 'pass-when' }, d.when),
  ].filter(Boolean));
  el.note.replaceChildren(...d.note.filter(Boolean));

  const ladder = prices();
  const member = isMember(me);
  el.join.hidden = member || me.source === 'owner' || !me.payments_ready || !ladder;
  el.manage.hidden = !me.paid;
  el.manage.classList.toggle('quiet', me.paid?.status !== 'past_due'); // a card to update: the one thing to do
  el.ownerSetting.hidden = !me.is_owner;
  el.ladder.hidden = !ladder;
  if (ladder) drawLadder(ladder, member ? me.paid : null);
}

function flare() {
  el.pass.classList.remove('is-flaring');
  void el.pass.offsetWidth;
  el.pass.classList.add('is-flaring');
}

// ---------- the price ladder: each month a star, falling to the last price, which repeats ----------
function drawLadder(list, paid) {
  const n = list.length;
  const high = Math.max(...list);
  const low = Math.min(...list);
  const y = (c) => (high === low ? 0.5 : 0.12 + (1 - (c - low) / (high - low)) * 0.76);
  const at = paid ? Math.min(Math.max(Number(paid.months_in_a_row) || 0, 0), n - 1) : -1;
  el.steps.style.setProperty('--n', String(n));
  el.steps.replaceChildren(...list.map((cents, i) => {
    const last = i === n - 1;
    const when = n === 1 ? 'Every month' : last ? 'Every month after' : ORDINAL[i] ? `${ORDINAL[i]} month` : `Month ${i + 1}`;
    const li = h('li', { class: ['ladder-step', last && 'is-last', i === at && 'is-now', i < at && 'is-past'].filter(Boolean).join(' ') },
      h('span', { class: 'ladder-star' }, star('ladder-glyph')),
      h('span', { class: 'ladder-price' }, money(cents)),
      h('span', { class: 'ladder-when' }, when),
      i === at ? h('span', { class: 'ladder-here' }, 'Your next month') : null);
    li.style.setProperty('--y', y(cents).toFixed(3));
    li.style.setProperty('--d', `${150 + i * 260}ms`);
    return li;
  }));
  const points = list.map((c, i) => [((i + 0.5) * 300) / n, y(c) * 100]);
  el.line.setAttribute('points', points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' '));
  const [lx, ly] = points[n - 1];
  el.tail.setAttribute('points', `${lx.toFixed(1)},${ly.toFixed(1)} 300,${ly.toFixed(1)}`);
  el.ladderText.textContent = n > 1 ? `Each month in a row costs less, down to ${money(low)}, for as long as it lasts.` : `${money(list[0])} a month.`;
  el.again.textContent = `Stop, and it starts over at ${money(list[0])}.`;
}

// ---------- back from Stripe: welcome, while the membership catches up ----------
async function welcome() {
  el.in.classList.add('is-welcome');
  el.title.textContent = 'Welcome to Afterglow';
  note('Thank you for joining. Stripe is confirming your payment…', 'info');
  setState('loading', 'Confirming your membership');
  const until = Date.now() + 2 * 60 * 1000;
  for (let first = true; Date.now() < until && who; first = false) {
    if (!first) await sleep(3000);
    try {
      me = await account.myAccess();
    } catch (err) {
      if (err.key === 'signed_out') return leave(err.message);
      continue; // offline for a moment: keep trying
    }
    if (isMember(me)) {
      render();
      note("You're a member. Thank you.");
      flare();
      return;
    }
  }
  if (!who) return;
  if (me) render(); else await load();
  note('Stripe is still confirming your payment. It can take a few minutes: refresh this page soon. Your receipt is in your email.', 'info');
}

// ---------- the test build ----------
function showBuild(found) {
  if (!found || !who) return;
  el.build.href = found.url;
  el.build.hidden = false;
  if (found.version) {
    el.buildVersion.textContent = `Test build, version ${found.version}. If your Mac won't open it: System Settings, Privacy & Security, Open Anyway (on macOS 14, Control-click it and choose Open).`;
    el.buildVersion.hidden = false;
  }
}

function focusInvite() {
  el.code.focus();
  el.code.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ---------- password and deleting ----------
function closePassword() {
  el.pwForm.hidden = true;
  el.pwOpen.hidden = false;
  el.pwOpen.setAttribute('aria-expanded', 'false');
  for (const i of [el.pwCurrent, el.pwNew]) { i.value = ''; i.type = 'password'; i.removeAttribute('aria-invalid'); }
  for (const t of el.pwForm.querySelectorAll('.pw-toggle')) { t.textContent = 'Show'; t.setAttribute('aria-label', 'Show password'); }
  say(el.pwMsg, '');
}

function closeDelete() {
  el.deletePanel.hidden = true;
  el.deleteOpen.hidden = false;
  el.deleteOpen.setAttribute('aria-expanded', 'false');
  el.deletePassword.value = '';
  el.deletePassword.type = 'password';
  el.deletePassword.removeAttribute('aria-invalid');
  say(el.deleteMsg, '');
}

// ---------- the buttons ----------
function wire() {
  el.join.addEventListener('click', () => run(el.join, async () => {
    say(el.passMsg, '');
    try {
      const { url } = await account.startCheckout();
      if (openStripe(url)) return LEAVING;
      say(el.passMsg, "Couldn't open the payment page. Try again in a minute.");
    } catch (err) {
      if (err.key === 'signed_out') return leave(err.message);
      if (err.key === 'payments_not_ready') {
        return say(el.passMsg, `${account.sentence('payments_not_ready')} If someone sent you an invite, use it below.`, 'info',
          { label: 'Use an invite', run: focusInvite });
      }
      say(el.passMsg, err.message);
    }
    return undefined;
  }));

  el.manage.addEventListener('click', () => run(el.manage, async () => {
    say(el.passMsg, '');
    try {
      const { url } = await account.openBillingPortal();
      if (openStripe(url)) return LEAVING;
      say(el.passMsg, "Couldn't open billing. Try again in a minute.");
    } catch (err) {
      if (err.key === 'signed_out') return leave(err.message);
      if (err.key === 'payments_not_ready') return say(el.passMsg, "Billing can't open right now. Try again soon.");
      say(el.passMsg, err.message);
    }
    return undefined;
  }));

  el.redeem.addEventListener('submit', (e) => {
    e.preventDefault();
    run(el.redeemButton, async () => {
      const value = el.code.value.trim();
      if (!value) return invalid(el.code, el.redeemMsg, 'Paste the invite link or code first.');
      say(el.redeemMsg, '');
      try {
        const r = await account.redeemInvite(value);
        el.code.value = '';
        say(el.redeemMsg, `${count(r.days_added, 'day', 'days')} added. You're in until ${shortDay(r.invite_until)}.`, 'ok');
        if (await load()) flare();
      } catch (err) {
        if (err.key === 'signed_out') return leave(err.message);
        if (err.key === 'invalid_or_used') return invalid(el.code, el.redeemMsg, err.message);
        say(el.redeemMsg, err.message);
      }
      return undefined;
    });
  });
  el.code.addEventListener('input', () => el.code.removeAttribute('aria-invalid'));

  // Change password: the current one signs in afresh, the new one is set with that session.
  el.pwOpen.addEventListener('click', () => {
    say(el.pwDone, '');
    el.pwForm.hidden = false;
    el.pwOpen.hidden = true;
    el.pwOpen.setAttribute('aria-expanded', 'true');
    el.pwCurrent.focus();
  });
  el.pwCancel.addEventListener('click', () => { closePassword(); el.pwOpen.focus(); });
  el.pwForm.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePassword(); el.pwOpen.focus(); } });
  for (const i of [el.pwCurrent, el.pwNew, el.deletePassword]) i.addEventListener('input', () => i.removeAttribute('aria-invalid'));
  el.pwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    run(el.pwSave, async () => {
      const current = el.pwCurrent.value;
      const next = el.pwNew.value;
      if (!current) return invalid(el.pwCurrent, el.pwMsg, 'Enter your current password.');
      if (!goodPassword(next)) return invalid(el.pwNew, el.pwMsg, account.sentence('weak_password'));
      if (next === current) return invalid(el.pwNew, el.pwMsg, 'That is your current password. Choose a different one.');
      say(el.pwMsg, '');
      try {
        await account.changePassword(current, next);
        closePassword();
        say(el.pwDone, 'Your password is changed. Your other devices, like the Mac app, are signed out: sign in there with the new password.', 'ok');
        el.pwOpen.focus();
      } catch (err) {
        if (err.key === 'signed_out') return leave(err.message);
        if (err.key === 'wrong_current_password') return invalid(el.pwCurrent, el.pwMsg, err.message);
        if (['weak_password', 'pwned_password', 'same_password'].includes(err.key)) return invalid(el.pwNew, el.pwMsg, err.message);
        say(el.pwMsg, err.message);
      }
      return undefined;
    });
  });

  el.signOut.addEventListener('click', () => run(el.signOut, async () => {
    who = ''; // signing out on purpose: no "you've been signed out" from the listener
    await account.signOut();
    leave("You're signed out.");
  }));

  // Delete: the password confirms it, and signs in afresh for the server's recent-sign-in check.
  el.deleteOpen.addEventListener('click', () => {
    el.deletePanel.hidden = false;
    el.deleteOpen.hidden = true;
    el.deleteOpen.setAttribute('aria-expanded', 'true');
    el.deletePassword.focus();
  });
  el.deleteCancel.addEventListener('click', () => { closeDelete(); el.deleteOpen.focus(); });
  el.deletePanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDelete(); el.deleteOpen.focus(); } });
  el.deletePanel.addEventListener('submit', (e) => {
    e.preventDefault();
    run(el.deleteButton, async () => {
      const password = el.deletePassword.value;
      if (!password) return invalid(el.deletePassword, el.deleteMsg, 'Enter your password to confirm.');
      say(el.deleteMsg, '');
      try {
        await account.deleteAccount(password);
        who = '';
        el.deletePassword.value = '';
        el.in.hidden = true;
        el.out.hidden = true;
        el.deleted.hidden = false;
        scrollTo({ top: 0 });
        el.deletedTitle.focus();
      } catch (err) {
        if (err.key === 'signed_out') return leave(err.message);
        if (err.key === 'wrong_current_password' || err.key === 'reauth_needed') {
          el.deletePassword.value = '';
          return invalid(el.deletePassword, el.deleteMsg, err.key === 'reauth_needed' ? err.message : "That isn't your password. Nothing has been deleted.");
        }
        if (err.key === 'payments_not_ready') {
          return say(el.deleteMsg, "This account's membership can't be ended right now, so it can't be deleted yet. Nothing has changed. Try again later.");
        }
        if (err.key === 'offline') { // no answer came back: it may or may not have gone through
          return say(el.deleteMsg, "No answer came back, so it isn't clear whether the account was deleted. Check your connection, then reload and try signing in to see.");
        }
        say(el.deleteMsg, `${err.message} Nothing has been deleted.`);
      }
      return undefined;
    });
  });
}

// Last, so every constant above exists before anything runs.
if (!framed()) start();
