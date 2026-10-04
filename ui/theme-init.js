// Runs synchronously in <head> so the correct theme is applied before first paint.
// Mirrors resolveTheme() in popup.js.
(function () {
    var pref = 'system';
    try {
        var raw = localStorage.getItem('theme');
        if (raw !== null) pref = JSON.parse(raw);
    } catch (e) {}
    var dark = pref === 'dark' ||
        (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
