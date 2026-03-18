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
    const openTabBtn = document.getElementById('openTabBtn');
    const themeToggleBtn = document.getElementById('themeToggleBtn');

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

    // ===================== State =====================
    let debounceTimer;
    let draftTimer;
    let currentBlob = null;      // PNG blob for download/copy
    let previewBlobUrl = null;    // blob URL for the <img> preview
    let pendingSvgBlobUrl = null; // track SVG blob URL for leak prevention
    let currentLatex = '';
    let renderGeneration = 0;    // incremented on each render; guards stale async callbacks

    // Defaults
    let settings = {
        textColor: '#000000',
        scaleFactor: 6.25,
        padding: 20
    };
    let history = [];   // [{ latex, timestamp }]  max 5
    let bookmarks = []; // [{ latex, timestamp }]

    // ===================== Theme =====================
    let currentTheme = 'system'; // 'system' | 'light' | 'dark'

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

    function applyTheme(theme) {
        currentTheme = theme;
        document.documentElement.dataset.theme = theme;
        themeToggleBtn.innerHTML = THEME_ICONS[theme];
        themeToggleBtn.title = THEME_LABELS[theme];
        themeToggleBtn.setAttribute('aria-label', THEME_LABELS[theme]);
    }

    // ===================== Storage helpers =====================
    // Guard against running outside the extension context (e.g. opening popup.html directly).
    const storage = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local : null;

    function loadAll(callback) {
        if (!storage) { applyTheme('system'); callback(); return; }
        storage.get(['settings', 'history', 'bookmarks', 'draft', 'theme'], (data) => {
            if (data.settings) settings = { ...settings, ...data.settings };
            if (data.history) history = data.history;
            if (data.bookmarks) bookmarks = data.bookmarks;
            if (data.draft) latexInput.value = data.draft;
            applyTheme(data.theme || 'system');
            callback();
        });
    }

    function saveSettings() {
        if (storage) storage.set({ settings });
    }
    function saveHistory() {
        if (storage) storage.set({ history });
    }
    function saveBookmarks() {
        if (storage) storage.set({ bookmarks });
    }
    function saveDraft() {
        if (!storage) return;
        const val = latexInput.value;
        if (val) {
            storage.set({ draft: val });
        } else {
            storage.remove('draft');
        }
    }

    // ===================== Settings UI =====================
    function applySettingsToUI() {
        // Color swatches
        colorSwatches.forEach((sw) => {
            sw.classList.toggle('active', sw.dataset.color === settings.textColor);
        });
        customColorInput.value = settings.textColor;

        // DPI
        dpiSelect.value = String(settings.scaleFactor);

        // Padding
        paddingRange.value = settings.padding;
        paddingValue.textContent = settings.padding;
    }

    function setColor(color) {
        settings.textColor = color;
        colorSwatches.forEach((sw) => {
            sw.classList.toggle('active', sw.dataset.color === color);
        });
        customColorInput.value = color;
        saveSettings();
        renderLatex();
    }

    colorSwatches.forEach((sw) => {
        sw.addEventListener('click', () => setColor(sw.dataset.color));
    });
    customColorInput.addEventListener('input', () => setColor(customColorInput.value));

    dpiSelect.addEventListener('change', () => {
        settings.scaleFactor = parseFloat(dpiSelect.value);
        saveSettings();
        renderLatex();
    });

    paddingRange.addEventListener('input', () => {
        settings.padding = parseInt(paddingRange.value, 10);
        paddingValue.textContent = settings.padding;
        saveSettings();
        renderLatex();
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
        const active = currentLatex && isBookmarked(currentLatex);
        bookmarkCurrentBtn.textContent = active ? '★' : '☆';
        bookmarkCurrentBtn.classList.toggle('active', active);
    }

    // ===================== History & Bookmarks logic =====================
    function addToHistory(latex) {
        // Remove duplicate if present
        history = history.filter((h) => h.latex !== latex);
        // Prepend
        history.unshift({ latex, timestamp: Date.now() });
        // Keep max 5
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
        latexInput.value = latex;
        latexInput.focus();
        hideDropdown();
        saveDraft();
        renderLatex();
    }

    // ===================== Render lists =====================
    function renderHistoryList() {
        historyList.innerHTML = '';
        historyEmpty.classList.toggle('hidden', history.length > 0);

        history.forEach((item) => {
            const li = document.createElement('li');

            const span = document.createElement('span');
            span.className = 'eq-latex';
            span.textContent = item.latex;
            span.title = item.latex;
            span.addEventListener('click', () => loadEquation(item.latex));

            const star = document.createElement('button');
            star.className = 'eq-star' + (isBookmarked(item.latex) ? ' bookmarked' : '');
            star.textContent = isBookmarked(item.latex) ? '★' : '☆';
            star.title = isBookmarked(item.latex) ? 'Remove bookmark' : 'Bookmark';
            star.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleBookmark(item.latex);
            });

            li.appendChild(span);
            li.appendChild(star);
            historyList.appendChild(li);
        });

        showLibrarySectionIfNeeded();
    }

    function renderBookmarksList() {
        bookmarksList.innerHTML = '';
        bookmarksEmpty.classList.toggle('hidden', bookmarks.length > 0);

        bookmarks.forEach((item) => {
            const li = document.createElement('li');

            const span = document.createElement('span');
            span.className = 'eq-latex';
            span.textContent = item.latex;
            span.title = item.latex;
            span.addEventListener('click', () => loadEquation(item.latex));

            const del = document.createElement('button');
            del.className = 'eq-delete';
            del.textContent = '✕';
            del.title = 'Remove bookmark';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleBookmark(item.latex);
            });

            li.appendChild(span);
            li.appendChild(del);
            bookmarksList.appendChild(li);
        });

        showLibrarySectionIfNeeded();
    }

    function showLibrarySectionIfNeeded() {
        const hasContent = history.length > 0 || bookmarks.length > 0;
        librarySection.classList.toggle('hidden', !hasContent);
    }

    // ===================== Core Rendering =====================
    function cleanup() {
        if (pendingSvgBlobUrl) {
            URL.revokeObjectURL(pendingSvgBlobUrl);
            pendingSvgBlobUrl = null;
        }
        if (previewBlobUrl) {
            URL.revokeObjectURL(previewBlobUrl);
            previewBlobUrl = null;
        }
        currentBlob = null;
    }

    const renderLatex = () => {
        const latexCode = latexInput.value.trim();
        currentLatex = latexCode;
        const generation = ++renderGeneration;

        cleanup();

        if (!latexCode) {
            resultContainer.classList.add('hidden');
            actionButtons.classList.add('hidden');
            errorMsg.classList.add('hidden');
            loadingMsg.classList.add('hidden');
            updateBookmarkCurrentBtn();
            return;
        }

        // Show loading
        resultContainer.classList.remove('hidden');
        loadingMsg.classList.remove('hidden');
        errorMsg.classList.add('hidden');
        resultImg.classList.add('hidden');
        actionButtons.classList.add('hidden');

        MathJax.tex2svgPromise(latexCode, { display: true })
            .then((node) => {
                if (generation !== renderGeneration) return;

                const svgElement = node.querySelector('svg');
                svgElement.style.backgroundColor = 'transparent';

                // Apply text color
                svgElement.setAttribute('color', settings.textColor);
                svgElement.style.color = settings.textColor;

                const svgMarkup = svgElement.outerHTML;
                const image = new Image();
                const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
                const svgUrl = URL.createObjectURL(svgBlob);
                pendingSvgBlobUrl = svgUrl;

                image.onload = () => {
                    const sf = settings.scaleFactor;
                    const pad = settings.padding;
                    const canvas = document.createElement('canvas');
                    canvas.width = (image.width + pad * 2) * sf;
                    canvas.height = (image.height + pad * 2) * sf;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, pad * sf, pad * sf, image.width * sf, image.height * sf);

                    // Use toBlob — never creates a huge data URL string
                    canvas.toBlob((blob) => {
                        if (generation !== renderGeneration) return;

                        if (!blob) {
                            showError('Failed to generate PNG.');
                            return;
                        }

                        currentBlob = blob;
                        previewBlobUrl = URL.createObjectURL(blob);
                        resultImg.src = previewBlobUrl;

                        loadingMsg.classList.add('hidden');
                        resultImg.classList.remove('hidden');
                        resultContainer.classList.remove('hidden');
                        actionButtons.classList.remove('hidden');

                        URL.revokeObjectURL(svgUrl);
                        pendingSvgBlobUrl = null;

                        updateBookmarkCurrentBtn();
                    }, 'image/png');
                };

                image.onerror = () => {
                    URL.revokeObjectURL(svgUrl);
                    pendingSvgBlobUrl = null;
                    if (generation !== renderGeneration) return;
                    showError('Failed to render SVG to image.');
                };

                image.src = svgUrl;
            })
            .catch((err) => {
                if (generation !== renderGeneration) return;
                console.error('MathJax Rendering Error:', err);
                showError('Invalid LaTeX — check your syntax.');
            });
    };

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
        if (!(e.key in BRACKET_PAIRS)) return;
        hideDropdown();

        const start = latexInput.selectionStart;
        const end = latexInput.selectionEnd;
        const val = latexInput.value;
        const prevChar = start > 0 ? val[start - 1] : '';
        const closer = prevChar === '\\' ? BACKSLASH_PAIRS[e.key] : BRACKET_PAIRS[e.key];

        e.preventDefault();

        if (start !== end) {
            const selected = val.slice(start, end);
            latexInput.value = val.slice(0, start) + e.key + selected + closer + val.slice(end);
            latexInput.selectionStart = start + 1;
            latexInput.selectionEnd = end + 1;
        } else {
            latexInput.value = val.slice(0, start) + e.key + closer + val.slice(start);
            latexInput.selectionStart = start + 1;
            latexInput.selectionEnd = start + 1;
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(renderLatex, 500);
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
        latexInput.value = val.slice(0, pos) + inner + closing + val.slice(pos);
        const cursorPos = pos + inner.length;
        latexInput.selectionStart = cursorPos;
        latexInput.selectionEnd = cursorPos;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(renderLatex, 500);
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
        marker.textContent = '\u200b'; // zero-width space
        mirror.appendChild(marker);
        document.body.appendChild(mirror);
        const markerRect = marker.getBoundingClientRect();
        document.body.removeChild(mirror);

        return {
            top:  markerRect.bottom + window.scrollY,
            left: markerRect.left   + window.scrollX,
        };
    }

    function scrollAcItemIntoView() {
        if (acIndex < 0) return;
        const items = acDropdown.querySelectorAll('.latex-ac-item');
        if (items[acIndex]) items[acIndex].scrollIntoView({ block: 'nearest' });
    }

    function setAcIndex(index) {
        acDropdown.querySelectorAll('.latex-ac-item').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });
        acIndex = index;
        scrollAcItemIntoView();
    }

    function applyCompletion(item) {
        const pos   = latexInput.selectionStart;
        const val   = latexInput.value;
        const start = pos - acQuery.length;
        latexInput.value = val.slice(0, start) + item.insert + val.slice(pos);
        const newCursor = start + item.insert.length - item.cursorBack;
        latexInput.selectionStart = newCursor;
        latexInput.selectionEnd   = newCursor;
        hideDropdown();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(renderLatex, 500);
        latexInput.focus();
    }

    function showDropdown(coords) {
        acDropdown.innerHTML = '';
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

        const bodyWidth = document.body.offsetWidth;
        acDropdown.style.top  = coords.top  + 'px';
        acDropdown.style.left = Math.min(coords.left, bodyWidth - 180) + 'px';
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
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(renderLatex, 500);
        clearTimeout(draftTimer);
        draftTimer = setTimeout(saveDraft, 500);
        updateAutocomplete();
    });

    downloadBtn.addEventListener('click', () => {
        if (!currentBlob) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage({
                    action: 'download',
                    dataUrl: reader.result,
                    filename: 'latex_render.png'
                });
            }
            addToHistory(currentLatex);
        };
        reader.readAsDataURL(currentBlob);
    });

    copyBtn.addEventListener('click', async () => {
        if (!currentBlob) return;
        try {
            await navigator.clipboard.write([new ClipboardItem({ [currentBlob.type]: currentBlob })]);
            addToHistory(currentLatex);
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.textContent = 'Copy Image';
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch (err) {
            console.error('Failed to copy image:', err);
        }
    });

    bookmarkCurrentBtn.addEventListener('click', () => {
        if (!currentLatex) return;
        toggleBookmark(currentLatex);
    });

    themeToggleBtn.addEventListener('click', () => {
        const next = THEME_CYCLE[currentTheme] || 'system';
        applyTheme(next);
        if (storage) storage.set({ theme: next });
    });

    openTabBtn.addEventListener('click', () => {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') + '?tab=1' });
        }
    });

    // ===================== Init =====================
    loadAll(() => {
        applySettingsToUI();
        renderHistoryList();
        renderBookmarksList();
        // Render initial equation
        setTimeout(renderLatex, 50);
    });

    // Hide the button when already running as a full tab (opened via the button itself)
    if (new URLSearchParams(location.search).get('tab') === '1') {
        openTabBtn.classList.add('hidden');
    }

    latexInput.focus();
    latexInput.select();
});
