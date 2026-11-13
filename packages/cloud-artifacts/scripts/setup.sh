#!/usr/bin/env bash
set -euo pipefail

BUCKET="${BUCKET:-cloud-artifacts}"

echo "==> Creating R2 bucket: $BUCKET"
npx wrangler r2 bucket create "$BUCKET" || echo "(already exists or creation deferred)"

echo "==> Adding lifecycle rule: prefix '7d/' -> expire after 7 days"
npx wrangler r2 bucket lifecycle add "$BUCKET" delete-7d "7d/" --expire-days 7 --force

echo "==> Adding lifecycle rule: prefix '30d/' -> expire after 30 days"
npx wrangler r2 bucket lifecycle add "$BUCKET" delete-30d "30d/" --expire-days 30 --force

echo "==> Setting secret TOKEN (paste value, then Enter)"
npx wrangler secret put TOKEN

cat <<'NEXT'

==> Done. Remaining manual steps:

  1. Bind a custom domain to the Worker (POST + GET both go through the Worker, single domain):
       Dashboard: Workers & Pages > cloud-artifacts > Settings > Domains & Routes > Add > Custom Domain
       Enter your domain (e.g. artifacts.example.com); Cloudflare adds the DNS record and SSL automatically.

  2. Update wrangler.toml [vars] PUBLIC_URL to the domain from the previous step (with https://, e.g. https://artifacts.example.com).

  3. Deploy:
       bun run deploy
NEXT
