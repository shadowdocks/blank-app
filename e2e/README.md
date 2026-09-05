# Hawk end-to-end tests

Run the fast Chromium suite with:

```sh
bun run test:e2e
```

The base config first checks whether Hawk is already running on port 5173 and reuses it. Otherwise it starts a temporary Vite server on port 6173, exactly 1000 above the normal frontend port. It also reuses an existing Hawk test server on 6173 after an interrupted run. The response must contain Hawk's page title, so an unrelated process is never reused.

API calls are mocked in `fixtures/hawk.ts`, so these core tests do not start or collide with the normal rqbit, Node, or Wrangler ports and do not depend on IMDb, Cloudflare, torrent providers, or network timing.

Use `hawkPage` for new tests:

```ts
import { expect, test } from "./fixtures/hawk"

test("opens a route", async ({ hawkPage: page }) => {
  await page.goto("/search")
  await expect(page.getByRole("heading", { name: "Search" })).toBeVisible()
})
```

Prefer roles and visible behavior over CSS selectors. Add only the API response needed by the test to `mockApi`. Traces and screenshots are retained automatically when a test fails. Use `bun run test:e2e:ui` for interactive debugging.
