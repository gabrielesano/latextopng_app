document.addEventListener('DOMContentLoaded', function () {
    // ===================== Element References =====================
    const latexInput = document.getElementById('latexInput');
    const resultContainer = document.getElementById('resultContainer');
    const actionButtons = document.getElementById('actionButtons');
    const resultImg = document.getElementById('resultImg');
    const downloadBtn = document.getElementById('downloadBtn');
    const copyBtn = document.getElementById('copyBtn');
    const bookmarkCurrentBtn = document.getElementById('bookmarkCurrentBtn');
    const loadingMsg = document.getElementById('loadingMsg');
    const errorMsg = document.getElementById('errorMsg');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const infoBtn = document.getElementById('infoBtn');
    const infoOverlay = document.getElementById('infoOverlay');
    const infoCloseBtn = document.getElementById('infoCloseBtn');
    const infoVersion = document.getElementById('infoVersion');

    // Settings
    const colorSwatches = document.querySelectorAll('.color-swatch');
    const customColorInput = document.getElementById('customColor');
    const dpiSelect = document.getElementById('dpiSelect');
    const paddingRange = document.getElementById('paddingRange');
    const paddingValue = document.getElementById('paddingValue');

    // Library
    const librarySection = document.getElementById('librarySection');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const historyList = document.getElementById('historyList');
    const bookmarksList = document.getElementById('bookmarksList');
    const historyEmpty = document.getElementById('historyEmpty');
    const bookmarksEmpty = document.getElementById('bookmarksEmpty');

    const tauri = window.__TAURI__;
    const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

    // ===================== State =====================
    const INPUT_DELAY    = 500; // debounce after typing
    const SETTINGS_DELAY = 120; // debounce for continuous controls (padding slider, colour picker)
    const CSS_DPI        = 96;  // scaleFactor 1 == 96 DPI

    let debounceTimer;
    let draftTimer;
    let currentBlob = null;      // PNG blob for download/copy
    let previewBlobUrl = null;   // blob URL for the <img> preview
    let cachedSvg = null;        // { latex, svg } from the last successful typeset
    let currentLatex = '';
    let renderGeneration = 0;    // incremented on each render; guards stale async callbacks
    let currentZoom = 1.0;
    let suppressAutocomplete = false; // set while we insert text programmatically

    // Defaults
    let settings = {
        textColor: '#000000',
        scaleFactor: 6.25,
        padding: 20
    };
    let history = [];   // [{ latex, timestamp }]  max 5
    let bookmarks = []; // [{ latex, timestamp }]  max 50

    // ===================== Theme =====================
    // Preference: 'system' | 'light' | 'dark'. 'system' follows the OS setting.
    let themePref = 'system';

    const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' };

    const THEME_LABELS = {
        system: 'Theme: System (follows OS)',
        light:  'Theme: Light',
        dark:   'Theme: Dark',
    };

    // SVG icon strings — one per state, rendered via innerHTML (static strings, no user data)
    const THEME_ICONS = {
        system: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="2" width="14" height="10" rx="1.5"/><polyline points="5,14 8,12 11,14"/></svg>',
        light:  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><line x1="8" y1="1" x2="8" y2="3.5"/><line x1="8" y1="12.5" x2="8" y2="15"/><line x1="1" y1="8" x2="3.5" y2="8"/><line x1="12.5" y1="8" x2="15" y2="8"/><line x1="3.4" y1="3.4" x2="5.2" y2="5.2"/><line x1="10.8" y1="10.8" x2="12.6" y2="12.6"/><line x1="12.6" y1="3.4" x2="10.8" y2="5.2"/><line x1="5.2" y1="10.8" x2="3.4" y2="12.6"/></svg>',
        dark:   '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 10.5a6 6 0 0 1-7.5-7.5A6 6 0 1 0 13 10.5z"/></svg>',
    };

    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Keep in sync with theme-init.js
    function resolveTheme(pref) {
        return pref === 'dark' || (pref === 'system' && darkQuery.matches) ? 'dark' : 'light';
    }

    function applyTheme(pref) {
        if (!THEME_CYCLE[pref]) pref = 'system';
        themePref = pref;
        document.documentElement.dataset.theme = resolveTheme(pref);
        themeToggleBtn.innerHTML = THEME_ICONS[pref];
        themeToggleBtn.title = THEME_LABELS[pref];
        themeToggleBtn.setAttribute('aria-label', THEME_LABELS[pref]);
    }

    darkQuery.addEventListener('change', () => {
        if (themePref === 'system') applyTheme('system');
    });

    // ===================== Storage helpers (localStorage) =====================
    function lsGet(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw !== null ? JSON.parse(raw) : fallback;
        } catch { return fallback; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    }
    function lsRemove(key) {
        try { localStorage.removeItem(key); } catch {}
    }

    function loadAll() {
        const saved = lsGet('settings');
        if (saved) settings = { ...settings, ...saved };
        history   = lsGet('history',   []);
        bookmarks = lsGet('bookmarks', []);
        const draft = lsGet('draft');
        if (draft) latexInput.value = draft;
        applyTheme(lsGet('theme', 'system'));
        applyZoom(lsGet('zoom', 1.0));
    }

    function saveSettings()  { lsSet('settings',  settings);  }
    function saveHistory()   { lsSet('history',   history);   }
    function saveBookmarks() { lsSet('bookmarks', bookmarks); }
    function saveDraft() {
        const val = latexInput.value;
        if (val) { lsSet('draft', val); } else { lsRemove('draft'); }
    }

    // ===================== Window Resize =====================
    const BASE_WIDTH  = 720;
    const BASE_HEIGHT = 960;

    function setWindowSize(w, h) {
        if (!tauri?.window) return;
        const { getCurrentWindow, LogicalSize } = tauri.window;
        getCurrentWindow().setSize(new LogicalSize(Math.round(w), Math.round(h)))
            .catch((err) => console.error('setSize failed:', err));
    }

    // ===================== Zoom =====================
    const ZOOM_STEP = 0.1;
    const ZOOM_MIN  = 0.5;
    const ZOOM_MAX  = 2.0;
    function applyZoom(z) {
        z = Number(z) || 1.0;
        currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 10) / 10));
        document.body.style.zoom = currentZoom;
        lsSet('zoom', currentZoom);
        // Clamp to the screen so the window never opens larger than the display
        setWindowSize(
            Math.min(BASE_WIDTH  * currentZoom, window.screen.availWidth  * 0.9),
            Math.min(BASE_HEIGHT * currentZoom, window.screen.availHeight * 0.9)
        );
    }

    // ===================== Info Panel =====================
    function closeInfoPanel()  { infoOverlay.classList.remove('open'); }
    function toggleInfoPanel() { infoOverlay.classList.toggle('open'); }

    infoBtn.addEventListener('click', toggleInfoPanel);
    infoCloseBtn.addEventListener('click', closeInfoPanel);
    infoOverlay.addEventListener('click', (e) => {
        if (e.target === infoOverlay) closeInfoPanel();
    });

    // Show the platform's modifier key in the shortcut list and tooltips
    if (IS_MAC) {
        infoOverlay.querySelectorAll('kbd').forEach((kbd) => {
            if (kbd.textContent === 'Ctrl') kbd.textContent = '⌘';
        });
        infoBtn.title = infoBtn.title.replace('Ctrl', '⌘');
    }

    tauri?.app?.getVersion?.()
        .then((v) => { infoVersion.textContent = 'v' + v; })
        .catch(() => {});

    // ===================== Global Keyboard Shortcuts =====================
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeInfoPanel(); return; }
        if (!(e.ctrlKey || e.metaKey)) return; // Ctrl on Windows/Linux, Cmd on macOS
        const k = e.key.toLowerCase();
        if (k === 's') {
            e.preventDefault();
            downloadBtn.click();
        } else if (k === 'c' && e.shiftKey) {
            e.preventDefault();
            copyBtn.click();
        } else if (k === 'b') {
            e.preventDefault();
            bookmarkCurrentBtn.click();
        } else if (k === 'i') {
            e.preventDefault();
            toggleInfoPanel();
        } else if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            applyZoom(currentZoom + ZOOM_STEP);
        } else if (e.key === '-') {
            e.preventDefault();
            applyZoom(currentZoom - ZOOM_STEP);
        } else if (e.key === '0') {
            e.preventDefault();
            applyZoom(1.0);
        }
    });

    // ===================== Settings UI =====================
    function applySettingsToUI() {
        colorSwatches.forEach((sw) => {
            sw.classList.toggle('active', sw.dataset.color === settings.textColor);
        });
        customColorInput.value = settings.textColor;
        dpiSelect.value = String(settings.scaleFactor);
        paddingRange.value = settings.padding;
        paddingValue.textContent = settings.padding;
    }

    function setColor(color, delay) {
        settings.textColor = color;
        colorSwatches.forEach((sw) => {
            sw.classList.toggle('active', sw.dataset.color === color);
        });
        customColorInput.value = color;
        saveSettings();
        scheduleRender(delay);
    }

    colorSwatches.forEach((sw) => {
        sw.addEventListener('click', () => setColor(sw.dataset.color, 0));
    });
    // 'input' fires continuously while dragging inside the picker
    customColorInput.addEventListener('input', () => setColor(customColorInput.value, SETTINGS_DELAY));

    dpiSelect.addEventListener('change', () => {
        settings.scaleFactor = parseFloat(dpiSelect.value);
        saveSettings();
        scheduleRender(0);
    });

    paddingRange.addEventListener('input', () => {
        settings.padding = parseInt(paddingRange.value, 10);
        paddingValue.textContent = settings.padding;
        saveSettings();
        scheduleRender(SETTINGS_DELAY);
    });

    // ===================== Tabs =====================
    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            tabBtns.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach((tc) => tc.classList.remove('active'));
            document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
        });
    });

    // ===================== Helpers =====================

    function isBookmarked(latex) {
        return bookmarks.some((b) => b.latex === latex);
    }

    function updateBookmarkCurrentBtn() {
        const active = !!currentLatex && isBookmarked(currentLatex);
        bookmarkCurrentBtn.textContent = active ? '★' : '☆';
        bookmarkCurrentBtn.classList.toggle('active', active);
    }

    // Temporarily swaps a button's label (e.g. "Copied!") and colour class.
    function flashButton(btn, text, cls) {
        if (!btn.dataset.label) btn.dataset.label = btn.textContent;
        clearTimeout(btn._flashTimer);
        btn.classList.remove('copied', 'failed');
        btn.textContent = text;
        btn.classList.add(cls);
        btn._flashTimer = setTimeout(() => {
            btn.textContent = btn.dataset.label;
            btn.classList.remove(cls);
        }, 2000);
    }

    // Replaces [start, end) in the textarea, then selects [selStart, selEnd).
    // Uses execCommand so the edit lands on the native undo stack (Ctrl+Z works);
    // assigning latexInput.value directly would wipe the undo history.
    function replaceRange(start, end, text, selStart, selEnd = selStart) {
        latexInput.focus();
        latexInput.setSelectionRange(start, end);
        suppressAutocomplete = true;
        const ok = document.execCommand('insertText', false, text);
        if (!ok) {
            latexInput.setRangeText(text, start, end, 'end');
            latexInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        suppressAutocomplete = false;
        latexInput.setSelectionRange(selStart, selEnd);
    }

    // ===================== History & Bookmarks logic =====================
    function addToHistory(latex) {
        history = history.filter((h) => h.latex !== latex);
        history.unshift({ latex, timestamp: Date.now() });
        if (history.length > 5) history = history.slice(0, 5);
        saveHistory();
        renderHistoryList();
    }

    function toggleBookmark(latex) {
        if (isBookmarked(latex)) {
            bookmarks = bookmarks.filter((b) => b.latex !== latex);
        } else {
            bookmarks.unshift({ latex, timestamp: Date.now() });
            if (bookmarks.length > 50) bookmarks = bookmarks.slice(0, 50);
        }
        saveBookmarks();
        renderBookmarksList();
        renderHistoryList(); // update star states
        updateBookmarkCurrentBtn();
    }

    function loadEquation(latex) {
        hideDropdown();
        replaceRange(0, latexInput.value.length, latex, latex.length);
        saveDraft();
        renderLatex();
    }

    // ===================== Render lists =====================
    // buildAction(latex) returns the trailing button for each row.
    function renderEquationList(listEl, emptyEl, items, buildAction) {
        listEl.replaceChildren();
        emptyEl.classList.toggle('hidden', items.length > 0);

        items.forEach((item) => {
            const li = document.createElement('li');

            const span = document.createElement('span');
            span.className = 'eq-latex';
            span.textContent = item.latex;
            span.title = item.latex;
            span.addEventListener('click', () => loadEquation(item.latex));

            li.append(span, buildAction(item.latex));
            listEl.appendChild(li);
        });

        const hasContent = history.length > 0 || bookmarks.length > 0;
        librarySection.classList.toggle('hidden', !hasContent);
    }

    function makeListButton(className, text, title, onClick) {
        const btn = document.createElement('button');
        btn.className = className;
        btn.textContent = text;
        btn.title = title;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    function renderHistoryList() {
        renderEquationList(historyList, historyEmpty, history, (latex) => {
            const marked = isBookmarked(latex);
            return makeListButton(
                'eq-star' + (marked ? ' bookmarked' : ''),
                marked ? '★' : '☆',
                marked ? 'Remove bookmark' : 'Bookmark',
                () => toggleBookmark(latex)
            );
        });
    }

    function renderBookmarksList() {
        renderEquationList(bookmarksList, bookmarksEmpty, bookmarks, (latex) =>
            makeListButton('eq-delete', '✕', 'Remove bookmark', () => toggleBookmark(latex))
        );
    }

    // ===================== PNG metadata (pHYs) =====================
    // Canvas PNGs carry no resolution info, so Word/PowerPoint/etc. assume 96 DPI
    // and a "600 DPI" image is inserted 6x too large. Writing a pHYs chunk makes
    // the file declare its real DPI so it is placed at the intended physical size.
    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let c = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }

    async function withDpi(blob, dpi) {
        const png = new Uint8Array(await blob.arrayBuffer());
        const view = new DataView(png.buffer);
        const ppm = Math.round(dpi / 0.0254); // pixels per metre

        const chunk = new Uint8Array(21); // length(4) + "pHYs"(4) + data(9) + crc(4)
        const cv = new DataView(chunk.buffer);
        cv.setUint32(0, 9);
        chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
        cv.setUint32(8, ppm);
        cv.setUint32(12, ppm);
        chunk[16] = 1; // unit: metre
        cv.setUint32(17, crc32(chunk.subarray(4, 17)));

        // Walk the chunks (after the 8-byte signature): replace an existing pHYs,
        // otherwise insert ours before the first IDAT (pHYs must precede image data).
        let pos = 8;
        while (pos + 8 <= png.length) {
            const len = view.getUint32(pos);
            const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
            if (type === 'pHYs') {
                return new Blob([png.subarray(0, pos), chunk, png.subarray(pos + 12 + len)], { type: 'image/png' });
            }
            if (type === 'IDAT') {
                return new Blob([png.subarray(0, pos), chunk, png.subarray(pos)], { type: 'image/png' });
            }
            pos += 12 + len;
        }
        return blob; // malformed PNG — leave untouched
    }

    // ===================== Core Rendering =====================
    // Two stages:
    //   typeset   — MathJax LaTeX → SVG; only re-run when the LaTeX changes (cached)
    //   rasterize — SVG → PNG via canvas; re-run for colour / DPI / padding changes

    function scheduleRender(delay = INPUT_DELAY) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(renderLatex, delay);
    }

    // Errors carrying a message meant for the user
    function userError(message) {
        const err = new Error(message);
        err.userMessage = message;
        return err;
    }

    function typeset(latex) {
        // Clear equation labels/numbers from previous renders, otherwise
        // re-rendering an equation with \label{} reports a duplicate label.
        MathJax.texReset();
        return MathJax.tex2svgPromise(latex, { display: true }).then((node) => {
            const svg = node.querySelector('svg');
            // MathJax does not reject on TeX errors: it renders the message
            // in red inside the SVG. Detect that and surface it as an error.
            const merror = svg.querySelector('[data-mjx-error]');
            if (merror) throw userError(merror.getAttribute('data-mjx-error'));
            cachedSvg = { latex, svg };
            return svg;
        });
    }

    function rasterize(svg, { textColor, scaleFactor: sf, padding: pad }) {
        return new Promise((resolve, reject) => {
            const clone = svg.cloneNode(true);
            clone.style.backgroundColor = 'transparent';
            clone.setAttribute('color', textColor);
            clone.style.color = textColor;

            const svgBlob = new Blob([clone.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
            const svgUrl = URL.createObjectURL(svgBlob);
            const image = new Image();

            image.onload = () => {
                URL.revokeObjectURL(svgUrl);
                const canvas = document.createElement('canvas');
                canvas.width  = Math.round((image.width  + pad * 2) * sf);
                canvas.height = Math.round((image.height + pad * 2) * sf);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, pad * sf, pad * sf, image.width * sf, image.height * sf);

                // toBlob never creates a huge data URL string; it yields null when
                // the canvas exceeds the engine's size limit.
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(userError('Image too large — try a lower resolution.'));
                }, 'image/png');
            };

            image.onerror = () => {
                URL.revokeObjectURL(svgUrl);
                reject(userError('Failed to render SVG to image.'));
            };

            image.src = svgUrl;
        });
    }

    function renderLatex() {
        clearTimeout(debounceTimer);
        const latexCode = latexInput.value.trim();
        currentLatex = latexCode;
        const generation = ++renderGeneration;
        const isCurrent = () => generation === renderGeneration;

        currentBlob = null;
        updateBookmarkCurrentBtn();

        if (!latexCode) {
            resultContainer.classList.add('hidden');
            actionButtons.classList.add('hidden');
            errorMsg.classList.add('hidden');
            loadingMsg.classList.add('hidden');
            return;
        }

        const cached = cachedSvg && cachedSvg.latex === latexCode;
        if (!cached) {
            // Only a new typeset shows the loading state; re-rasterizing for a
            // settings change keeps the previous preview visible (no flicker).
            resultContainer.classList.remove('hidden');
            loadingMsg.classList.remove('hidden');
            errorMsg.classList.add('hidden');
            resultImg.classList.add('hidden');
            actionButtons.classList.add('hidden');
        }

        const opts = { ...settings }; // snapshot: settings may change mid-render
        (cached ? Promise.resolve(cachedSvg.svg) : typeset(latexCode))
            .then((svg) => isCurrent() ? rasterize(svg, opts) : null)
            .then((blob) => blob && isCurrent() ? withDpi(blob, opts.scaleFactor * CSS_DPI) : null)
            .then((blob) => {
                if (blob && isCurrent()) showResult(blob);
            })
            .catch((err) => {
                if (!isCurrent()) return;
                console.error('Rendering error:', err);
                showError(err.userMessage || 'Invalid LaTeX — check your syntax.');
            });
    }

    function showResult(blob) {
        currentBlob = blob;
        const url = URL.createObjectURL(blob);
        resultImg.src = url;
        // Revoke the old URL only after swapping, so the preview never blanks
        if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
        previewBlobUrl = url;

        loadingMsg.classList.add('hidden');
        errorMsg.classList.add('hidden');
        resultImg.classList.remove('hidden');
        resultContainer.classList.remove('hidden');
        actionButtons.classList.remove('hidden');
        updateBookmarkCurrentBtn();
    }

    function showError(msg) {
        loadingMsg.classList.add('hidden');
        resultImg.classList.add('hidden');
        errorMsg.textContent = msg;
        errorMsg.classList.remove('hidden');
        resultContainer.classList.remove('hidden');
        actionButtons.classList.add('hidden');
        currentBlob = null;
    }

    // ===================== Auto-completion =====================

    const BRACKET_PAIRS = { '(': ')', '[': ']', '{': '}' };
    const BACKSLASH_PAIRS = { '(': '\\)', '[': '\\]', '{': '\\}' };
    const ENVIRONMENTS = new Set([
        'align', 'align*', 'equation', 'equation*',
        'matrix', 'pmatrix', 'bmatrix', 'vmatrix',
        'cases', 'gathered', 'split',
    ]);

    function handleBracketCompletion(e) {
        if (e.defaultPrevented) return;
        if (!(e.key in BRACKET_PAIRS)) return;
        hideDropdown();

        const start = latexInput.selectionStart;
        const end = latexInput.selectionEnd;
        const val = latexInput.value;
        const prevChar = start > 0 ? val[start - 1] : '';
        const closer = prevChar === '\\' ? BACKSLASH_PAIRS[e.key] : BRACKET_PAIRS[e.key];

        e.preventDefault();

        if (start !== end) {
            // Wrap the selection and keep it selected
            replaceRange(start, end, e.key + val.slice(start, end) + closer, start + 1, end + 1);
        } else {
            replaceRange(start, end, e.key + closer, start + 1);
        }
    }

    function handleEnvironmentCompletion(e) {
        if (e.defaultPrevented) return;
        if (e.key !== 'Enter') return;
        if (latexInput.selectionStart !== latexInput.selectionEnd) return;

        const pos = latexInput.selectionStart;
        const val = latexInput.value;
        const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        const lineText = val.slice(lineStart, pos);
        const match = lineText.match(/\\begin\{([^}]+)\}\s*$/);
        if (!match) return;

        const envName = match[1];
        if (!ENVIRONMENTS.has(envName)) return;

        e.preventDefault();

        const indent = lineText.match(/^(\s*)/)[1];
        const inner = '\n' + indent + '    ';
        const closing = '\n' + indent + '\\end{' + envName + '}';
        replaceRange(pos, pos, inner + closing, pos + inner.length);
    }

    // ===================== Command Autocomplete =====================

    const LATEX_COMMANDS = [
        // Fractions / roots
        { cmd: '\\frac',           insert: '\\frac{}{}',          cursorBack: 3 },
        { cmd: '\\dfrac',          insert: '\\dfrac{}{}',         cursorBack: 3 },
        { cmd: '\\tfrac',          insert: '\\tfrac{}{}',         cursorBack: 3 },
        { cmd: '\\sqrt',           insert: '\\sqrt{}',            cursorBack: 1 },
        // Integrals / sums
        { cmd: '\\int',            insert: '\\int',               cursorBack: 0 },
        { cmd: '\\iint',           insert: '\\iint',              cursorBack: 0 },
        { cmd: '\\iiint',          insert: '\\iiint',             cursorBack: 0 },
        { cmd: '\\oint',           insert: '\\oint',              cursorBack: 0 },
        { cmd: '\\sum',            insert: '\\sum',               cursorBack: 0 },
        { cmd: '\\prod',           insert: '\\prod',              cursorBack: 0 },
        // Relations
        { cmd: '\\leq',            insert: '\\leq',               cursorBack: 0 },
        { cmd: '\\geq',            insert: '\\geq',               cursorBack: 0 },
        { cmd: '\\neq',            insert: '\\neq',               cursorBack: 0 },
        { cmd: '\\approx',         insert: '\\approx',            cursorBack: 0 },
        { cmd: '\\equiv',          insert: '\\equiv',             cursorBack: 0 },
        { cmd: '\\sim',            insert: '\\sim',               cursorBack: 0 },
        { cmd: '\\propto',         insert: '\\propto',            cursorBack: 0 },
        // Arrows
        { cmd: '\\to',             insert: '\\to',                cursorBack: 0 },
        { cmd: '\\leftarrow',      insert: '\\leftarrow',         cursorBack: 0 },
        { cmd: '\\rightarrow',     insert: '\\rightarrow',        cursorBack: 0 },
        { cmd: '\\Rightarrow',     insert: '\\Rightarrow',        cursorBack: 0 },
        { cmd: '\\Leftrightarrow', insert: '\\Leftrightarrow',    cursorBack: 0 },
        { cmd: '\\mapsto',         insert: '\\mapsto',            cursorBack: 0 },
        // Operators
        { cmd: '\\sin',            insert: '\\sin',               cursorBack: 0 },
        { cmd: '\\cos',            insert: '\\cos',               cursorBack: 0 },
        { cmd: '\\tan',            insert: '\\tan',               cursorBack: 0 },
        { cmd: '\\log',            insert: '\\log',               cursorBack: 0 },
        { cmd: '\\ln',             insert: '\\ln',                cursorBack: 0 },
        { cmd: '\\exp',            insert: '\\exp',               cursorBack: 0 },
        { cmd: '\\lim',            insert: '\\lim',               cursorBack: 0 },
        { cmd: '\\inf',            insert: '\\inf',               cursorBack: 0 },
        { cmd: '\\sup',            insert: '\\sup',               cursorBack: 0 },
        { cmd: '\\max',            insert: '\\max',               cursorBack: 0 },
        { cmd: '\\min',            insert: '\\min',               cursorBack: 0 },
        // Accents
        { cmd: '\\hat',            insert: '\\hat{}',             cursorBack: 1 },
        { cmd: '\\bar',            insert: '\\bar{}',             cursorBack: 1 },
        { cmd: '\\vec',            insert: '\\vec{}',             cursorBack: 1 },
        { cmd: '\\dot',            insert: '\\dot{}',             cursorBack: 1 },
        { cmd: '\\ddot',           insert: '\\ddot{}',            cursorBack: 1 },
        { cmd: '\\tilde',          insert: '\\tilde{}',           cursorBack: 1 },
        { cmd: '\\overline',       insert: '\\overline{}',        cursorBack: 1 },
        { cmd: '\\underline',      insert: '\\underline{}',       cursorBack: 1 },
        // Delimiters
        { cmd: '\\left',           insert: '\\left',              cursorBack: 0 },
        { cmd: '\\right',          insert: '\\right',             cursorBack: 0 },
        { cmd: '\\langle',         insert: '\\langle',            cursorBack: 0 },
        { cmd: '\\rangle',         insert: '\\rangle',            cursorBack: 0 },
        { cmd: '\\lfloor',         insert: '\\lfloor',            cursorBack: 0 },
        { cmd: '\\rfloor',         insert: '\\rfloor',            cursorBack: 0 },
        { cmd: '\\lceil',          insert: '\\lceil',             cursorBack: 0 },
        { cmd: '\\rceil',          insert: '\\rceil',             cursorBack: 0 },
        // Spacing / formatting
        { cmd: '\\quad',           insert: '\\quad',              cursorBack: 0 },
        { cmd: '\\qquad',          insert: '\\qquad',             cursorBack: 0 },
        { cmd: '\\text',           insert: '\\text{}',            cursorBack: 1 },
        { cmd: '\\mathrm',         insert: '\\mathrm{}',          cursorBack: 1 },
        { cmd: '\\mathbf',         insert: '\\mathbf{}',          cursorBack: 1 },
        { cmd: '\\mathcal',        insert: '\\mathcal{}',         cursorBack: 1 },
        { cmd: '\\mathbb',         insert: '\\mathbb{}',          cursorBack: 1 },
        // Misc
        { cmd: '\\partial',        insert: '\\partial',           cursorBack: 0 },
        { cmd: '\\nabla',          insert: '\\nabla',             cursorBack: 0 },
        { cmd: '\\infty',          insert: '\\infty',             cursorBack: 0 },
        { cmd: '\\forall',         insert: '\\forall',            cursorBack: 0 },
        { cmd: '\\exists',         insert: '\\exists',            cursorBack: 0 },
        { cmd: '\\in',             insert: '\\in',                cursorBack: 0 },
        { cmd: '\\notin',          insert: '\\notin',             cursorBack: 0 },
        { cmd: '\\subset',         insert: '\\subset',            cursorBack: 0 },
        { cmd: '\\cup',            insert: '\\cup',               cursorBack: 0 },
        { cmd: '\\cap',            insert: '\\cap',               cursorBack: 0 },
        { cmd: '\\cdot',           insert: '\\cdot',              cursorBack: 0 },
        { cmd: '\\times',          insert: '\\times',             cursorBack: 0 },
        { cmd: '\\otimes',         insert: '\\otimes',            cursorBack: 0 },
        { cmd: '\\oplus',          insert: '\\oplus',             cursorBack: 0 },
        { cmd: '\\dagger',         insert: '\\dagger',            cursorBack: 0 },
        { cmd: '\\hbar',           insert: '\\hbar',              cursorBack: 0 },
    ];

    const acDropdown = document.createElement('div');
    acDropdown.className = 'latex-ac hidden';
    document.body.appendChild(acDropdown);

    let acQuery = '';
    let acItems = [];
    let acIndex = -1;

    // Returns {top, left} in document coordinates just below the caret.
    function getCaretCoords(el) {
        const computed = window.getComputedStyle(el);
        const elRect = el.getBoundingClientRect();

        // Mirror div positioned exactly over the textarea using fixed coords.
        const mirror = document.createElement('div');
        Object.assign(mirror.style, {
            position: 'fixed',
            top: elRect.top + 'px',
            left: elRect.left + 'px',
            width: elRect.width + 'px',
            boxSizing: 'border-box',
            visibility: 'hidden',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            fontFamily: computed.fontFamily,
            fontSize: computed.fontSize,
            fontWeight: computed.fontWeight,
            lineHeight: computed.lineHeight,
            letterSpacing: computed.letterSpacing,
            paddingTop: computed.paddingTop,
            paddingRight: computed.paddingRight,
            paddingBottom: computed.paddingBottom,
            paddingLeft: computed.paddingLeft,
            borderTopWidth: computed.borderTopWidth,
            borderRightWidth: computed.borderRightWidth,
            borderBottomWidth: computed.borderBottomWidth,
            borderLeftWidth: computed.borderLeftWidth,
            borderStyle: 'solid',
            borderColor: 'transparent',
        });
        mirror.appendChild(document.createTextNode(el.value.slice(0, el.selectionStart)));
        const marker = document.createElement('span');
        marker.textContent = '​'; // zero-width space
        mirror.appendChild(marker);
        document.body.appendChild(mirror);
        const markerRect = marker.getBoundingClientRect();
        document.body.removeChild(mirror);

        return {
            top:  markerRect.bottom + window.scrollY,
            left: markerRect.left   + window.scrollX,
        };
    }

    function setAcIndex(index) {
        const items = acDropdown.children;
        for (let i = 0; i < items.length; i++) items[i].classList.toggle('active', i === index);
        acIndex = index;
        if (items[index]) items[index].scrollIntoView({ block: 'nearest' });
    }

    function applyCompletion(item) {
        const pos   = latexInput.selectionStart;
        const start = pos - acQuery.length;
        hideDropdown();
        replaceRange(start, pos, item.insert, start + item.insert.length - item.cursorBack);
    }

    function showDropdown(coords) {
        acDropdown.replaceChildren();
        acItems.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'latex-ac-item' + (i === acIndex ? ' active' : '');
            const cmdSpan = document.createElement('span');
            cmdSpan.textContent = item.cmd;
            div.appendChild(cmdSpan);
            if (item.insert !== item.cmd) {
                const argsSpan = document.createElement('span');
                argsSpan.className = 'ac-args';
                argsSpan.textContent = item.insert.slice(item.cmd.length);
                div.appendChild(argsSpan);
            }
            div.addEventListener('mousedown', (e) => {
                e.preventDefault(); // keep textarea focused
                applyCompletion(item);
            });
            acDropdown.appendChild(div);
        });

        // Keep the dropdown inside the body's right edge (same coordinate space as coords)
        const bodyRight = document.body.getBoundingClientRect().right + window.scrollX;
        acDropdown.style.top  = coords.top + 'px';
        acDropdown.style.left = Math.max(0, Math.min(coords.left, bodyRight - 180)) + 'px';
        acDropdown.classList.remove('hidden');
    }

    function hideDropdown() {
        acDropdown.classList.add('hidden');
        acItems = [];
        acIndex = -1;
        acQuery = '';
    }

    function updateAutocomplete() {
        const pos = latexInput.selectionStart;
        const val = latexInput.value;
        // Scan back over word chars (letters + * for starred variants) to find \cmd
        let i = pos;
        while (i > 0 && /[a-zA-Z*]/.test(val[i - 1])) i--;
        if (i > 0 && val[i - 1] === '\\') {
            acQuery = val.slice(i - 1, pos); // includes the leading '\'
            if (acQuery.length < 2) { hideDropdown(); return; }
            const matches = LATEX_COMMANDS.filter(c => c.cmd.startsWith(acQuery));
            if (matches.length === 0) { hideDropdown(); return; }
            acItems = matches;
            acIndex = -1;
            showDropdown(getCaretCoords(latexInput));
        } else {
            hideDropdown();
        }
    }

    function handleAutocompleteKeydown(e) {
        if (acDropdown.classList.contains('hidden')) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAcIndex((acIndex + 1) % acItems.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAcIndex(acIndex <= 0 ? acItems.length - 1 : acIndex - 1);
        } else if (e.key === 'Tab') {
            // Tab always selects (first item if none highlighted)
            e.preventDefault();
            applyCompletion(acItems[acIndex >= 0 ? acIndex : 0]);
        } else if (e.key === 'Enter' && acIndex >= 0) {
            // Enter selects only when an item is explicitly highlighted,
            // so a plain Enter still allows env-completion or newline.
            e.preventDefault();
            applyCompletion(acItems[acIndex]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            hideDropdown();
        }
    }

    // Dismiss when clicking outside the textarea and dropdown
    document.addEventListener('mousedown', (e) => {
        if (!acDropdown.contains(e.target) && e.target !== latexInput) {
            hideDropdown();
        }
    });

    // ===================== Event Listeners =====================
    latexInput.addEventListener('keydown', (e) => {
        handleAutocompleteKeydown(e);
        handleBracketCompletion(e);
        handleEnvironmentCompletion(e);
    });

    latexInput.addEventListener('input', () => {
        scheduleRender();
        clearTimeout(draftTimer);
        draftTimer = setTimeout(saveDraft, 500);
        if (suppressAutocomplete) hideDropdown();
        else updateAutocomplete();
    });

    downloadBtn.addEventListener('click', async () => {
        if (!currentBlob) return;
        if (!tauri?.core?.invoke) {
            console.error('Tauri invoke not available');
            return;
        }
        const latex = currentLatex;
        try {
            // Sent as a raw binary IPC body (no base64 round-trip)
            const bytes = new Uint8Array(await currentBlob.arrayBuffer());
            const saved = await tauri.core.invoke('save_png', bytes);
            if (saved) {
                addToHistory(latex);
                flashButton(downloadBtn, 'Saved!', 'copied');
            }
        } catch (err) {
            console.error('save_png failed:', err);
            flashButton(downloadBtn, 'Save failed', 'failed');
        }
    });

    copyBtn.addEventListener('click', async () => {
        if (!currentBlob) return;
        const latex = currentLatex;
        try {
            await navigator.clipboard.write([new ClipboardItem({ [currentBlob.type]: currentBlob })]);
            addToHistory(latex);
            flashButton(copyBtn, 'Copied!', 'copied');
        } catch (err) {
            console.error('Failed to copy image:', err);
            flashButton(copyBtn, 'Copy failed', 'failed');
        }
    });

    bookmarkCurrentBtn.addEventListener('click', () => {
        if (!currentLatex) return;
        toggleBookmark(currentLatex);
    });

    themeToggleBtn.addEventListener('click', () => {
        const next = THEME_CYCLE[themePref];
        applyTheme(next);
        lsSet('theme', next);
    });

    // ===================== Init =====================
    loadAll();
    applySettingsToUI();
    renderHistoryList();
    renderBookmarksList();

    latexInput.focus();
    latexInput.select();

    // Render the initial equation once MathJax has finished starting up
    if (window.MathJax?.startup?.promise) {
        MathJax.startup.promise.then(renderLatex).catch((err) => {
            console.error('MathJax startup failed:', err);
            showError('MathJax failed to load.');
        });
    } else {
        showError('MathJax failed to load.');
    }
});
