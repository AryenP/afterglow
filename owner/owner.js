// The owner's invite links: make them (shown once), see every link and who
// used it, and revoke one that hasn't been used. The server decides who the
// owner is; this page only follows what it says.

import * as account from '../account/afterglow-account.js';
import { $, h, star, say, invalid, run, mountAuth, framed, shortDay, count, copyText } from '../account/ui.js';

const STATUS = { open: 'Open', redeemed: 'Redeemed', revoked: 'Revoked', expired: 'Expired' };
const el = {
  head: $('#own-head'), checking: $('#own-checking'), gate: $('#own-gate'), denied: $('#own-denied'), deniedTitle: $('#denied-title'),
  deniedEmail: $('#denied-email'), deniedOut: $('#denied-out'), console: $('#own-console'), out: $('#own-out'),
  nOpen: $('#n-open'), nRedeemed: $('#n-redeemed'), nRevoked: $('#n-revoked'), nExpired: $('#n-expired'),
  make: $('#make'), note: $('#make-note'), noteCount: $('#note-count'), count: $('#make-count'), days: $('#make-days'),
  makeMsg: $('#make-msg'), makeButton: $('#make-button'), makeLabel: $('#make-label'),
  fresh: $('#fresh'), freshTitle: $('#fresh-title'), freshMeta: $('#fresh-meta'), freshList: $('#fresh-list'), freshMsg: $('#fresh-msg'),
  copyAll: $('#copy-all'), freshDone: $('#fresh-done'),
  listTitle: $('#list-title'), listMsg: $('#list-msg'), refresh: $('#list-refresh'), table: $('#invites'), rows: $('#invite-rows'), empty: $('#list-empty'),
};

let who = '';
let auth;
let fresh = []; // the links just made: in this page's memory only, until hidden

function start() {
  auth = mountAuth($('#own-auth'), {
    start: 'signin',
    allowCreate: false,
    onSignedIn: () => enter(),
  });
  // Signed out from here on (an ended session, a spent token): back to the form.
  account.onSessionChange((s) => { if (!s && who) gate("You've been signed out. Sign in again to carry on."); });
  wire();
  if (account.signedInUser()) enter();
  else gate(undefined, { fresh: false });
}

function only(section) {
  for (const s of [el.gate, el.denied, el.console]) s.hidden = s !== section;
  el.head.hidden = section === el.gate; // the signed-out view has its own heading beside the form
  el.checking.hidden = section !== null;
}

function gate(message, { fresh = true } = {}) {
  who = '';
  hideFresh();
  only(el.gate);
  if (fresh) auth.reset('signin'); // not on arrival: the form may be waiting for a code from before a reload
  if (message) auth.notice(message, 'info');
}

async function enter() {
  const user = account.signedInUser();
  if (!user) return gate();
  who = user.id;
  only(null);
  let me;
  try {
    me = await account.myAccess();
  } catch (err) {
    if (err.key === 'signed_out') return gate(err.message);
    only(el.gate);
    return auth.notice(err.message, 'error');
  }
  if (!me.is_owner) return denied(me.email || user.email);
  only(el.console);
  await load();
}

/** "not_owner" can also mean the session ended elsewhere (the server checks it's still alive):
 *  ask again to tell the two apart. */
async function recheck() {
  try {
    const me = await account.myAccess();
    if (me.is_owner) return say(el.listMsg, account.sentence('server'));
    denied(me.email);
  } catch (err) {
    if (err.key === 'signed_out') return gate(err.message);
    say(el.listMsg, err.message);
  }
  return undefined;
}

function denied(email) {
  hideFresh();
  only(el.denied);
  el.deniedEmail.textContent = email || account.signedInUser()?.email || '';
  el.deniedTitle.focus();
}

// ---------- every link ----------
async function load() {
  try {
    const list = await account.listInvites();
    render(Array.isArray(list) ? list : []);
    return true;
  } catch (err) {
    if (err.key === 'signed_out') { gate(err.message); return false; }
    if (err.key === 'not_owner') { await recheck(); return false; }
    say(el.listMsg, err.message, 'error', { label: 'Try again', run: () => run(el.refresh, load) });
    return false;
  }
}

function render(list) {
  const tally = { open: 0, redeemed: 0, revoked: 0, expired: 0 };
  for (const inv of list) if (Object.hasOwn(tally, inv.status)) tally[inv.status] += 1;
  el.nOpen.textContent = String(tally.open);
  el.nRedeemed.textContent = String(tally.redeemed);
  el.nRevoked.textContent = String(tally.revoked);
  el.nExpired.textContent = String(tally.expired);
  el.table.hidden = list.length === 0;
  el.empty.hidden = list.length > 0;
  el.rows.replaceChildren(...list.map(row));
}

const when = (iso) => (iso ? h('time', { datetime: iso }, shortDay(iso)) : null);

function row(inv) {
  const status = Object.hasOwn(STATUS, inv.status) ? inv.status : 'expired';
  const gone = status === 'revoked' || status === 'expired';
  const note = typeof inv.note === 'string' && inv.note ? inv.note : '';
  return h('tr', { role: 'row', class: gone ? 'is-gone' : null },
    h('td', { role: 'cell', class: 'inv-for' },
      h('span', { class: note ? 'inv-note' : 'inv-note is-empty' }, note || 'No note'),
      h('span', { class: 'inv-days' }, `${count(Number(inv.days) || 0, 'day', 'days')} free`)),
    h('td', { role: 'cell', class: 'inv-status' }, chip(status)),
    h('td', { role: 'cell', class: 'inv-date', 'data-label': 'Made' }, when(inv.created_at)),
    h('td', { role: 'cell', class: 'inv-date', 'data-label': status === 'expired' ? 'Expired' : 'Expires' },
      status === 'open' || status === 'expired' ? when(inv.expires_at) : null),
    h('td', { role: 'cell', class: 'inv-who', 'data-label': 'Used by' },
      status === 'redeemed' ? [h('span', null, inv.redeemed_email || 'An account since deleted'), h('small', null, 'on ', when(inv.redeemed_at))] : null),
    h('td', { role: 'cell', class: 'inv-action' }, status === 'open' ? revokeButton(inv) : null),
  );
}

function chip(status) {
  return h('span', { class: 'chip', 'data-status': status }, status === 'redeemed' || status === 'open' ? star() : null, STATUS[status]);
}

// Revoking asks first, in the row itself.
function revokeButton(inv) {
  const button = h('button', { type: 'button', class: 'button quiet small revoke' }, 'Revoke');
  button.addEventListener('click', () => askRevoke(button.closest('td'), inv));
  return button;
}

function askRevoke(cell, inv) {
  const keep = h('button', { type: 'button', class: 'button quiet small' }, 'Keep it');
  const yes = h('button', { type: 'button', class: 'button small danger' }, star(), 'Revoke');
  const box = h('div', { class: 'inv-confirm', role: 'group', 'aria-label': `Revoke the link ${inv.note ? `for ${inv.note}` : 'with no note'}?` },
    h('span', null, 'Stop this link working?'), keep, yes);
  cell.replaceChildren(box);
  keep.focus();
  const back = () => { const b = revokeButton(inv); cell.replaceChildren(b); b.focus(); };
  keep.addEventListener('click', back);
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });
  yes.addEventListener('click', () => run(yes, async () => {
    try {
      const done = await account.revokeInvite(inv.id);
      say(el.listMsg, done
        ? `Revoked${inv.note ? ` the link for ${inv.note}` : ''}. It won't work for anyone now.`
        : 'That link was already used or revoked, so nothing changed.', done ? 'ok' : 'info');
    } catch (err) {
      if (err.key === 'signed_out') return gate(err.message);
      if (err.key === 'not_owner') return recheck();
      say(el.listMsg, err.message);
    }
    await load();
    el.listTitle.focus();
    return undefined;
  }));
}

// ---------- new links, shown once ----------
function showFresh(made, note, days) {
  fresh = made;
  el.freshTitle.textContent = made.length === 1 ? 'Your new link' : `${made.length} new links`;
  el.fresh.querySelector('.fresh-warn strong').textContent = made.length === 1
    ? "Copy it now: this is the only time it's shown."
    : "Copy them now: this is the only time they're shown.";
  el.freshMeta.textContent = [note ? `For ${note}` : '', `${count(days, 'free day', 'free days')} each`,
    `unused, ${made.length === 1 ? 'it stops' : 'they stop'} working ${shortDay(made[0]?.expires_at)}`].filter(Boolean).join(' · ');
  el.freshList.replaceChildren(...made.map((inv, i) => {
    const copy = h('button', { type: 'button', class: 'fresh-copy', 'aria-label': made.length > 1 ? `Copy link ${i + 1}` : 'Copy link' }, 'Copy');
    const link = h('span', { class: 'fresh-link' }, inv.link);
    copy.addEventListener('click', () => copyOne(copy, link, inv.link));
    return h('li', null, link, copy);
  }));
  el.copyAll.hidden = made.length < 2;
  el.freshDone.textContent = made.length === 1 ? "I've copied it. Hide it for good" : "I've copied them. Hide them for good";
  say(el.freshMsg, '');
  el.fresh.hidden = false;
  el.fresh.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.fresh.focus({ preventScroll: true });
}

function hideFresh() {
  fresh = [];
  el.freshList.replaceChildren();
  el.fresh.hidden = true;
}

async function copyOne(button, node, text) {
  if (await copyText(text)) {
    button.textContent = 'Copied';
    button.classList.add('is-copied');
    setTimeout(() => { button.textContent = 'Copy'; button.classList.remove('is-copied'); }, 2000);
  } else {
    getSelection().selectAllChildren(node);
    say(el.freshMsg, "Couldn't copy by itself. The link is selected: press ⌘C to copy it.", 'info');
  }
}

// ---------- the form and the buttons ----------
function wire() {
  const label = () => {
    const n = Number(el.count.value);
    el.makeLabel.textContent = Number.isInteger(n) && n >= 1 && n <= 50 ? `Make ${count(n, 'link', 'links')}` : 'Make links';
  };
  const noteLength = () => { el.noteCount.textContent = `${[...el.note.value].length} of 80`; };
  el.count.addEventListener('input', () => { el.count.removeAttribute('aria-invalid'); label(); });
  el.days.addEventListener('input', () => el.days.removeAttribute('aria-invalid'));
  el.note.addEventListener('input', () => { el.note.removeAttribute('aria-invalid'); noteLength(); });
  label();
  noteLength();

  el.make.addEventListener('submit', (e) => {
    e.preventDefault();
    run(el.makeButton, async () => {
      const howMany = Number(el.count.value);
      const days = Number(el.days.value);
      const note = el.note.value.trim();
      if (!Number.isInteger(howMany) || howMany < 1 || howMany > 50) return invalid(el.count, el.makeMsg, account.sentence('bad_count'));
      if (!Number.isInteger(days) || days < 1 || days > 90) return invalid(el.days, el.makeMsg, account.sentence('bad_days'));
      if ([...note].length > 80) return invalid(el.note, el.makeMsg, account.sentence('note_too_long'));
      say(el.makeMsg, '');
      try {
        const made = await account.createInvites({ howMany, note, days });
        if (!Array.isArray(made) || made.length === 0) return say(el.makeMsg, account.sentence('server'));
        showFresh(made, note, days);
        el.note.value = '';
        noteLength();
        await load();
      } catch (err) {
        if (err.key === 'signed_out') return gate(err.message);
        if (err.key === 'not_owner') return recheck();
        say(el.makeMsg, err.message);
      }
      return undefined;
    });
  });

  el.copyAll.addEventListener('click', async () => {
    const all = fresh.map((inv) => inv.link).join('\n');
    if (await copyText(all)) say(el.freshMsg, `Copied all ${fresh.length} links, one per line.`, 'ok');
    else {
      getSelection().selectAllChildren(el.freshList);
      say(el.freshMsg, "Couldn't copy by itself. The links are selected: press ⌘C to copy them.", 'info');
    }
  });
  el.freshDone.addEventListener('click', () => { hideFresh(); el.listTitle.focus(); });
  el.refresh.addEventListener('click', () => run(el.refresh, async () => { if (await load()) say(el.listMsg, 'Up to date.', 'info'); }));

  const signOut = (button) => run(button, async () => { who = ''; await account.signOut(); gate("You're signed out."); });
  el.out.addEventListener('click', () => signOut(el.out));
  el.deniedOut.addEventListener('click', () => signOut(el.deniedOut));
}

// Last, so every constant above exists before anything runs.
if (!framed()) start();
