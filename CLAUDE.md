# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Tauri 2.x desktop application that converts LaTeX expressions to PNG images. The frontend was ported from a Chrome extension and runs entirely client-side using MathJax for rendering. The Rust backend provides a single command, `save_png`, which shows a native save dialog and writes the file.

## Build & Run Commands

```bash
# Install Tauri CLI (if not already installed)
cargo install tauri-cli --version "^2" --locked

# Run in development mode (hot-reload for frontend, recompile for Rust)
cargo tauri dev

# Build production bundle
cargo tauri build
```

No frontend build step is required. Tauri serves the static HTML/CSS/JS directly from `ui/` (`frontendDist: "../ui"` in `tauri.conf.json`).

Releases are built by `.github/workflows/build.yml` when a `v*` tag is pushed (Linux, Windows, macOS arm64 + x86_64).

## Architecture

### Frontend (`ui/`)
- `index.html` — UI markup (textarea, settings panel, result preview, history/bookmarks tabs, info overlay)
- `popup.js` — All application logic
- `popup.css` — Light/dark theme via CSS custom properties (`html[data-theme="dark"]`)
- `theme-init.js` — Applies the saved theme in `<head>` before first paint
- `mathjax-config.js` — MathJax config (must load before the library)
- `lib/tex-svg-full.js` — Bundled MathJax 3 (2.2 MB); runs client-side for LaTeX→SVG conversion

No inline `<script>` tags: the CSP in `tauri.conf.json` only allows scripts from `'self'`.

### Backend (`src-tauri/`)
- `src/main.rs` — Entry point; delegates to `lib.rs`
- `src/lib.rs` — Tauri builder, `tauri-plugin-dialog`, `tauri-plugin-log` (debug only), `save_png` command
- `tauri.conf.json` — Window config (720×960), CSP, bundles all targets
- `capabilities/default.json` — `core:default`, `dialog:allow-save`, `core:window:allow-set-size`

### Rendering Pipeline

```
User input → debounce 500ms
  → typeset:   MathJax.tex2svgPromise()  (cached per LaTeX string)
  → rasterize: SVG Blob → <img> → Canvas → canvas.toBlob(png)
  → withDpi:   insert pHYs chunk so the PNG declares its DPI
  → display preview + enable copy/download buttons
```

Key implementation details in `popup.js`:
- Colour / DPI / padding changes only re-run the rasterize step (the SVG is cached)
- MathJax renders TeX errors into the SVG instead of rejecting; `typeset()` detects `data-mjx-error` and shows the message. `noundefined` is disabled so unknown macros also error.
- A generation counter guards against stale async callbacks
- Scale factor maps to DPI (×96): 1.5625/3.125/6.25 → 150/300/600
- Text edits made by autocompletion go through `replaceRange()` (`execCommand('insertText')`) so native undo keeps working
- Settings, history, bookmarks, draft, theme and zoom persist in `localStorage`
- Shortcuts accept Ctrl or Cmd (macOS)

### IPC
- Download: `invoke('save_png', uint8Array)` sends the PNG as a raw binary body; Rust reads it via `tauri::ipc::Request` / `InvokeBody::Raw`. Returns `false` if the dialog is cancelled.

## Key Tauri Integration Points

When adding Tauri commands (Rust↔JS IPC):
- Define commands in `src-tauri/src/lib.rs` with `#[tauri::command]`
- Register them in `.invoke_handler(tauri::generate_handler![...])`
- Call from frontend with `window.__TAURI__.core.invoke('command_name', args)`
- Add required permissions to `capabilities/default.json`
