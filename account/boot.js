// Runs in the head of the account pages, before they draw. The other pages do
// this inline; these allow no inline script (Content-Security-Policy).
(function () {
  var root = document.documentElement;
  // The site's entrances, and the mark drawing once a visit.
  root.classList.add('js');
  try {
    if (sessionStorage.getItem('afterglow-seen')) root.classList.add('seen');
    sessionStorage.setItem('afterglow-seen', '1');
  } catch (e) {}

  // Never inside another site's frame: nobody gets to dress these buttons up as something else.
  if (window.top !== window.self) root.classList.add('framed');

  // An invite's code arrives after the # in its link. Take it out of the address bar
  // straight away and hold it in this tab only, until the invite is used.
  var me = document.currentScript;
  if (me && me.hasAttribute('data-invite') && location.hash.length > 1) {
    var code = location.hash.slice(1);
    history.replaceState(null, '', location.pathname + location.search);
    try { sessionStorage.setItem('afterglow-invite', code); }
    catch (e) { Object.defineProperty(window, 'afterglowInvite', { value: code, configurable: true }); }
  }
})();
