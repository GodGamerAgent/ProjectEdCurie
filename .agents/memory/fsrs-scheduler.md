---
name: FSRS scheduler API
description: Version-specific integration detail for the installed ts-fsrs major version.
---

Use the modern `DefaultScheduler` API and explicitly select FSRS-7 for review scheduling. Its card fields are camelCase (`dueAt`, `lastReviewAt`, `scheduledDays`), unlike the deprecated legacy FSRS card's snake_case fields. Persist the complete returned card and review log; PostgreSQL JSONB arrives from `pg` as an object, not necessarily a string.

**Why:** The installed package's current types reject the legacy `fsrs()/Card` example, and parsing JSONB as a string fails at runtime.

**How to apply:** Check the installed `ts-fsrs` major version and its matching README/types before implementing or migrating review state.
