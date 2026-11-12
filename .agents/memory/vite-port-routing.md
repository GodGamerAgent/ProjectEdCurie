---
name: Direct URL and Vite WebSocket
description: Why a direct development URL can show Upgrade Required before authentication.
---

Vite in middleware mode can open a separate WebSocket-only port. If Replit forwards the direct URL to that port, ordinary page requests receive HTTP 426 before they reach the app.

**Why:** The direct development URL was routed to Vite's live-update socket rather than the Express application.

**How to apply:** When debugging this symptom, compare the app and WebSocket listeners and the external port mapping. Share Vite's WebSocket with the app's HTTP server. If the workspace preview uses an explicit `:5000` URL, forward both external ports 80 and 5000 to the app's port 5000; forwarding only port 80 breaks that preview URL.
