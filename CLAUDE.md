# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A no-build browser chat UI (Japanese) for a local OpenAI-compatible LLM server (LM Studio), intended to be hosted on Cloudflare Pages and reach LM Studio over Tailscale. No package manager, tests, linter or git repo. Plans and design decisions are in `spec/` (`README.md` = scope/acceptance criteria, `design.md` = details); keep them in sync when changing behavior.

To run, serve the directory statically (e.g. `python -m http.server`) or open `index.html`. A reachable LLM server with CORS enabled is required. An https-hosted page cannot call `http://` endpoints (mixed content), so use Tailscale Serve for https.

## Layout

- `index.html`: markup for the sidebar, chat and settings modal.
- `css/style.css`: styles. Theming uses CSS variables, with `html[data-theme=dark|light]` set by JS to the resolved theme.
- `js/app.js`: all logic, as one script.
- `vendor/`: marked, DOMPurify and highlight.js, vendored rather than loaded from a CDN. The CSP in `_headers` forbids external scripts. `_headers` is the Cloudflare Pages header config.

## Architecture (`js/app.js`)

- **Storage**
  - `settings`, `connections`, `activeConnection`, `presets` and `model:<connId>` always live in `localStorage`.
  - `chats` and `currentId` live in whichever store `settings.chatStorage` selects (`chatStore()`), either local or session. `persist()` writes them; call it after mutating `chats` or `currentId`.
  - `migrate()` converts the legacy `s_*` keys on first run. Chat data format `{id,title,system,messages:[{role,content,reasoning?}]}` is unchanged.
- **Connections**: a list of `{id,name,baseUrl,apiKey}`. `conn()`, `baseUrl()` and `authHeaders()` are used by both `loadModels()` (GET `/models`) and `generate()` (POST `/chat/completions`, SSE streaming or plain).
- **Rendering**: `setBody()` updates persistent child nodes (`details.think` and `.main`) so streaming doesn't reset the reasoning block's open state. Assistant text goes through `marked`, then `DOMPurify`, then `innerHTML`; keep that order. User text is plain `textContent`. Streaming repaints are throttled with `requestAnimationFrame`.
- **Input**: the send key is configurable (`settings.sendKey`). The keydown handler must skip IME composition (`isComposing` / keyCode 229).
- **Settings modal**: controls with `s_<key>` ids are bound generically by `bind()`. Changes apply and save immediately. Changing `chatStorage` goes through `switchStorage()`, which migrates the chat data.
