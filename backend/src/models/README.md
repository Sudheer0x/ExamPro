# Models

We are using plain SQL (via the `mysql2` connection pool in `src/config/database.js`)
rather than a heavyweight ORM, so "models" here are just query-helper modules —
one per table/entity (e.g. `studentModel.js`, `examinationModel.js`) — each
exporting simple functions like `findById()`, `create()`, `updateStatus()`.

These will be added starting in Phase 2, alongside the first controllers that need them.
