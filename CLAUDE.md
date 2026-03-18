# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Tauri 2.x desktop application that converts LaTeX expressions to PNG images. The frontend was ported from a Chrome extension and runs entirely client-side using MathJax for rendering. The Rust/Tauri backend currently acts only as a shell — no custom Tauri commands or IPC are implemented yet.

## Build & Run Commands

```bash
# Install Tauri CLI (if not already installed)
cargo install tauri-cli

# Run in development mode (hot-reload for frontend, recompile for Rust)
cargo tauri dev

# Build production bundle
cargo tauri build
```

No frontend build step is required — Tauri serves the static HTML/CSS/JS directly from the project root (`frontendDist: "../"` in `tauri.conf.json`).

## Architecture

### Frontend (HTML/CSS/JS in project root)
- `index.html` — UI markup (textarea, settings panel, result preview, history/bookmarks tabs)
- `popup.js` — All application logic
- `popup.css` — Light/dark theme via CSS custom properties
- `lib/tex-svg-full.js` — Bundled MathJax 2.2 MB; runs client-side for LaTeX→SVG conversion

### Backend (`src-tauri/`)
- `src/main.rs` — Entry point; delegates to `lib.rs`
- `src/lib.rs` — Minimal Tauri app builder + `tauri-plugin-log` (debug only)
- `tauri.conf.json` — Window config (800×600), CSP disabled, bundles all targets
- `capabilities/default.json` — Minimal permissions (`core:default` only)

### Rendering Pipeline

```
User input → debounce 500ms → MathJax.tex2svgPromise()
  → SVG Blob → <img> element → Canvas → canvas.toBlob(png)
  → display preview + enable copy/download buttons
```

Key implementation details in `popup.js`:
- Generation counter guards prevent stale async callbacks
- Object URLs are revoked after use to prevent memory leaks
- Scale factor maps to DPI: 150/300/600

### Chrome Extension Remnants
The codebase still contains `chrome.*` API calls (storage, runtime, tabs). These are guarded with `typeof chrome !== 'undefined'` checks and are no-ops in the Tauri context. Settings/history/bookmarks persistence is currently broken in Tauri (requires replacing `chrome.storage.local` with Tauri's fs or store plugin).

## Key Tauri Integration Points

When adding Tauri commands (Rust↔JS IPC):
- Define commands in `src-tauri/src/lib.rs` with `#[tauri::command]`
- Register them in `.invoke_handler(tauri::generate_handler![...])`
- Call from frontend with `window.__TAURI__.core.invoke('command_name', args)`
- Add required permissions to `capabilities/default.json`
