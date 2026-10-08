---
'@rhinestone/sdk': minor
---

Drop the optional `express` peer dependency. `createExpressRouter` from `@rhinestone/sdk/jwt-server` now returns a plain middleware function instead of an Express router object, so the SDK no longer needs `express` installed. Mount it exactly as before — `app.use(path, express.json(), createExpressRouter(config))` — on Express 4 or 5; it now also type-checks against `@types/express`. If you added routes to the returned router, mount your own router alongside it instead.
