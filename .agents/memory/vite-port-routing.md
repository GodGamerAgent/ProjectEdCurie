---
name: Direct URL and Vite WebSocket
description: Why a direct development URL can show Upgrade Required before authentication.
---

Vite in middleware mode can open a separate WebSocket-only port. If Replit forwards the direct URL to that port, ordinary page requests receive HTTP 426 before they reach the app.

**Why:** The direct development URL was routed to Vite's live-update socket rather than the Express application.

**How to apply:** When debugging this symptom, compare the app and WebSocket listeners and the external port mapping. Share Vite's WebSocket with the app's HTTP server. This workspace's automatic forwarding can restore the legacy WebSocket port as the direct URL mapping after a restart or later; changing the mapping alone is not durable. Ensure that port serves the same protected HTTP app and forwards WebSocket upgrades, while the preview keeps port 5000.
