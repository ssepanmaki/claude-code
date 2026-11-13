# cloud-artifacts

> A standalone Cloudflare Worker + R2 service for hosting HTML artifacts.
>
> A server (CLI / RCS backend) uploads HTML with a single bearer token and gets back a publicly reachable URL.
> Files are deleted automatically by an R2 lifecycle rule when they expire (7 days by default, 30 days at most).

Throughout this README, `$WORKER_URL` stands for the public origin of your deployment (the `PUBLIC_URL` in `wrangler.toml`).

## Quickstart

```bash
# Upload an html file (random ID + 7-day TTL by default)
echo '<h1>hello</h1>' > /tmp/t.html
curl -X POST "$WORKER_URL/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @/tmp/t.html
# {"id":"V1StGXR8_Z5jdHi6B-myT",
#  "url":"<WORKER_URL>/7d/V1StGXR8_Z5jdHi6B-myT.html",
#  "expiresAt":"2026-06-27T10:00:00.000Z"}

# Anyone with the url can open it
curl "$WORKER_URL/7d/V1StGXR8_Z5jdHi6B-myT.html"
```

## Architecture

```
                          ┌──────────────────────────┐
client  --POST /upload---▶│  Cloudflare Worker        │
                          │  - auth + MIME + size check│
                          │  - ttl∈{7,30} + hash check │
                          │  - R2 put / R2 get        │
                          └────────────┬─────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │  R2 bucket                │
                          │  key: <7d|30d>/<id>.html  │
                          │  lifecycle:               │
                          │    7d/  -> expire 7 days  │
                          │    30d/ -> expire 30 days │
                          └──────────────────────────┘
```

- **POST /upload**: Bearer auth → text/html check → 10MB limit → ttl ∈ {7,30} → R2 put
- **GET /<7d\|30d>/<id>.html**: the Worker reads from R2 → returns `text/html; charset=utf-8` + `Cache-Control: public, max-age=86400`
- **TTL**: implemented with an R2 prefix + lifecycle rule; the Worker takes no part in expiry (zero extra code)
- **Overwrite**: when `?hash=` is given, first delete the old `7d/<hash>.html` and `30d/<hash>.html` keys, then write the new key
- **ID**: `nanoid(21)` by default (126 bits of entropy); a custom one can be given with `?hash=<custom-id>`

## Putting a proxy in front (optional)

If the Worker's edge is hard to reach from some networks, you can put your own edge proxy (for example Deno Deploy) in front of it and use that proxy's origin as `PUBLIC_URL`.

- Request and response bodies must be passed through unchanged.
- **Side effect to watch for**: a proxy may flatten the upstream HTTP status code to 200 (the `{error: ...}` field in the body is preserved). A client that relies on the status code to tell error types apart should parse the `error` field in the body instead. When talking to the Worker directly (for example `*.workers.dev`), status codes pass through normally.

## API

### `POST /upload`

| Header / Query | Required | Description |
|----------------|----------|-------------|
| `Authorization: Bearer <TOKEN>` | yes | Must exactly equal the Worker secret `TOKEN` |
| `Content-Type: text/html` | yes | No other type is accepted |
| `?ttl=7\|30` | no | Defaults to 7; **only 7 or 30 are allowed** (they correspond to the R2 lifecycle prefixes) |
| `?hash=<custom-id>` | no | Custom ID, validated against `^[A-Za-z0-9_-]{1,128}$`; when given, an older version with the same ID is overwritten |
| body | yes | Raw HTML (`--data-binary @file.html`), ≤10MB |

Success (200):

```json
{
  "id": "V1StGXR8_Z5jdHi6B-myT",
  "url": "<WORKER_URL>/7d/V1StGXR8_Z5jdHi6B-myT.html",
  "expiresAt": "2026-06-27T10:00:00.000Z"
}
```

Errors (always `{ "error": "<code>" }`; status codes below):

| Status (direct) | error code | Trigger |
|--------|------------|----------|
| 400 | `invalid_ttl` | `ttl` is not 7 or 30 |
| 400 | `invalid_hash` | `hash` does not match `^[A-Za-z0-9_-]{1,128}$` |
| 401 | `unauthorized` | Missing Authorization / token mismatch |
| 404 | `not_found` | Path is not `/upload`, or the GET path does not match `/<7d\|30d>/<id>.html` |
| 413 | `payload_too_large` | body > 10MB |
| 415 | `unsupported_media_type` | Content-Type is not `text/html` |

> **Behind a status-flattening proxy**: every error status above comes back as **200**, but the body is still the `{error: ...}` JSON from the table. Client parsing logic should rely on the `error` field in the body.

### `GET /<ttl-prefix>/<id>.html`

`ttl-prefix` must be `7d` or `30d` (other paths return 404/not_found). Returns `text/html; charset=utf-8` + `Cache-Control: public, max-age=86400`. Anyone with the URL can open it; the hash is the secret.

## Examples

```bash
# Random ID + 7 days (default)
curl -X POST "$WORKER_URL/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @/tmp/t.html

# Custom hash + 30 days (uploading the same hash again overwrites it)
curl -X POST "$WORKER_URL/upload?ttl=30&hash=my-report" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @/tmp/report.html

# Fetch
curl "$WORKER_URL/7d/V1StGXR8_Z5jdHi6B-myT.html"
```

## Overwrite semantics

When `?hash=` is given:

1. Validate the hash character set (`^[A-Za-z0-9_-]{1,128}$`)
2. Delete both the `7d/<hash>.html` and `30d/<hash>.html` keys (R2 delete does not error on a missing key, and costs nothing)
3. Write the new key according to `?ttl=`
4. Return the new `expiresAt`

When `?hash=` is not given: a random `nanoid(21)` ID is used; collisions are practically impossible, so no collision check is done.

## Deployment

Prerequisite: you have run `npx wrangler login` for the target Cloudflare account. Any proxy layer in front of the Worker is configured separately by the deployer.

```bash
cd packages/cloud-artifacts
bun install                          # running it at the monorepo root also works (workspace is detected automatically)

cp .dev.vars.example .dev.vars       # fill in the TOKEN for local dev (read only by wrangler dev)
bun run setup                        # create the bucket + add the lifecycle rules + set the production TOKEN secret

# Bind a Worker custom domain (if you want to serve from a domain directly on Cloudflare):
#   Dashboard: Workers & Pages > cloud-artifacts > Settings > Domains & Routes > Add > Custom Domain

# Set [vars] PUBLIC_URL in wrangler.toml to the public origin (your custom domain or workers.dev URL)

bun run deploy
```

## Testing

`scripts/test.sh` covers 7 error cases + 3 success cases + an R2 write verification. **It supports two modes**: when talking to the Worker directly it asserts on the HTTP status code; behind a proxy that flattens status to 200 it automatically asserts on the `error` field in the body (marked `[via body]`).

```bash
WORKER_URL=<your-worker-origin> \
TOKEN=<your-token> \
bash scripts/test.sh
```

## Local development

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and fill in TOKEN

bun run dev                          # wrangler dev, starts local Miniflare + a local R2 simulation
curl -X POST "http://localhost:8787/upload" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: text/html" \
  --data-binary @/tmp/t.html
```

## Security notes

- **TOKEN is the only authentication on the upload side**: if the value leaks, anyone can upload/overwrite. In production use a random string of ≥32 characters and rotate it regularly (`wrangler secret put TOKEN` takes effect immediately, no redeploy needed).
- **GET is fully public**: URLs look like `/<ttl>/<id>.html`, and the hash (a 21-character nanoid) is the only secret. Do not paste the URL into a public channel and expect it to stay "private".
- **Overwrite is a write**: anyone holding the token who knows a hash can overwrite that ID's content. If you need "immutable after creation" semantics, enforce it on the client (do not pass `?hash=`).
- **HTML content is not validated**: uploaded html is returned as-is, and the browser will execute any `<script>` in it. This service is meant for "hosting html you produced yourself" and must not be used as an upload endpoint for arbitrary users.
- **TTL is capped at 30 days**: the lifecycle rule is a prefix-level global rule, so every object is kept for at most 30 days and this cannot be extended.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Every request returns HTTP 200 but the operation failed | Normal behind a status-flattening proxy; read the `error` field in the body for the real status |
| The response html has an extra `<a href="/cdn-cgi/content...">` and `<script>` | Browser Insights (RUM) injected by Cloudflare by default; it does not affect rendering. For a clean response: dashboard → Workers & Pages → cloud-artifacts → turn off Web Analytics |
| Upload returns 413 but the file is under 10MB | Check whether the `Content-Length` header was rewritten by an intermediary; the Worker validates both `Content-Length` and `arrayBuffer().byteLength` |
| `?ttl=14` returns 400 | By design; only 7 or 30 are allowed (matching the R2 lifecycle prefixes) |
| `wrangler secret list` shows TOKEN but uploads return 401 | The token values differ. Run `wrangler secret put TOKEN` again with the correct value |

## Dependencies

- `wrangler` ^4 — Cloudflare Workers CLI
- `nanoid` ^5 — ID generation (pure ESM, Worker compatible)

## Not referenced by the main CLI

This is a standalone Cloudflare Worker service, positioned like `packages/remote-control-server/`. The root `package.json` of the monorepo has `workspaces: ["packages/*", ...]`, which picks this package up automatically, but the main CLI never imports it.
