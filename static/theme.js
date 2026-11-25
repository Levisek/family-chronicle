// Look of the site (Chronicle / Night / Atlas): loaded in <head> without defer, so that the page
// does not flash in the default colours before the settings panel (settings.js) is ready.
(function () {
  'use strict';
  try {
    var t = localStorage.getItem('chronicle.theme');
    if (t === 'night' || t === 'atlas') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* private window: the default Chronicle look stays */ }
})();
