// MathJax configuration — must load before lib/tex-svg-full.js.
// Kept in a separate file so the CSP does not need 'unsafe-inline' for scripts.
window.MathJax = {
    // Without 'noundefined', an unknown macro like \foo raises an error that we
    // can show to the user, instead of being drawn in red inside the PNG.
    tex: { packages: { '[-]': ['noundefined'] } },
    svg: { fontCache: 'none' },          // self-contained SVGs (no shared glyph cache)
    startup: { typeset: false }          // we only call tex2svgPromise() on demand
};
