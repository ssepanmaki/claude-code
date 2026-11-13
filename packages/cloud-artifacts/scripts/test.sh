#!/usr/bin/env bash
# cloud-artifacts end-to-end test script
# Usage:
#   WORKER_URL=https://cloud-artifacts.claude-code-best.workers.dev \
#   TOKEN=claude-code-best \
#   bash scripts/test.sh
#
# If workers.dev is unreachable from this machine, go through a proxy:
#   HTTPS_PROXY=http://127.0.0.1:7890 bash scripts/test.sh ...

set -uo pipefail

WORKER_URL="${WORKER_URL:-https://cloud-artifacts.claude-code-best.win}"
TOKEN="${TOKEN:-claude-code-best}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Colors
G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[0m'

# Prepare test html
echo '<!doctype html><title>t</title><h1>hello v1</h1>' > "$TMP/v1.html"
echo '<!doctype html><title>t</title><h1>hello v2 (overwritten)</h1>' > "$TMP/v2.html"

# 11MB html (for the 413 test)
yes '<p>x</p>' | head -c 11000000 > "$TMP/big.html"

pass=0; fail=0
# expect: primary assertion is the status code; if a proxy flattens every status to 200 but the body is still an error JSON,
# fall back to asserting on the error field in the body (marked [via body]).
expect() {
  local label="$1" want_code="$2" resp="$3" code="$4" body="$5"
  if [[ "$code" == "$want_code" ]]; then
    printf "${G}✓ %s -> HTTP %s${D}\n" "$label" "$code"
    [[ -n "$resp" ]] && printf "    body: %s\n" "$body"
    pass=$((pass+1))
    return
  fi
  # Proxy passthrough fallback: HTTP 200 + body is {"error":"..."} JSON
  if [[ "$code" == "200" && "$body" == {\"error\":* ]]; then
    local want_error=""
    case "$want_code" in
      401) want_error="unauthorized" ;;
      415) want_error="unsupported_media_type" ;;
      413) want_error="payload_too_large" ;;
      404) want_error="not_found" ;;
      400) want_error="invalid_" ;; # invalid_ttl invalid_ttl or invalid_hash, prefix match
    esac
    if [[ -z "$want_error" ]] || echo "$body" | grep -q "\"error\":\"$want_error"; then
      printf "${G}✓ %s -> HTTP 200 [via body] %s${D}\n" "$label" "$body"
      pass=$((pass+1))
      return
    fi
  fi
  printf "${R}✗ %s -> HTTP %s (expected %s)${D}\n" "$label" "$code" "$want_code"
  printf "    body: %s\n" "$body"
  fail=$((fail+1))
}

call() {
  local label="$1" want="$2"
  shift 2
  curl -sS -o "$TMP/resp" -w "%{http_code}" "$@" > "$TMP/code"
  expect "$label" "$want" "" "$(cat "$TMP/code")" "$(cat "$TMP/resp")"
}

echo "===== Error cases ====="

# 1. 401 unauthorized
call "no token" 401 \
  -X POST "$WORKER_URL/upload" \
  -H "Content-Type: text/html" --data-binary "@$TMP/v1.html"

# 2. 401 wrong token
call "wrong token" 401 \
  -X POST "$WORKER_URL/upload" \
  -H "Authorization: Bearer wrong" \
  -H "Content-Type: text/html" --data-binary "@$TMP/v1.html"

# 3. 415 wrong MIME
call "wrong content-type" 415 \
  -X POST "$WORKER_URL/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" --data-binary '{"x":1}'

# 4. 400 invalid_ttl
call "ttl=999" 400 \
  -X POST "$WORKER_URL/upload?ttl=999" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" --data-binary "@$TMP/v1.html"

# 5. 400 invalid_ttl (negative number)
call "ttl=0" 400 \
  -X POST "$WORKER_URL/upload?ttl=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" --data-binary "@$TMP/v1.html"

# 6. 400 invalid_hash
call "hash=bad/slash" 400 \
  -X POST "$WORKER_URL/upload?hash=bad/slash" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" --data-binary "@$TMP/v1.html"

# 7. 413 payload_too_large (11MB > 10MB)
call "11MB body" 413 \
  -X POST "$WORKER_URL/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" --data-binary "@$TMP/big.html"

# 8. 404 not_found (wrong path)
call "wrong path" 404 \
  -X POST "$WORKER_URL/notupload" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" --data-binary "@$TMP/v1.html"

echo
echo "===== Success cases ====="

# 9. 200 random ID + 7 days (default)
echo "--- Default upload (random ID + 7 days) ---"
curl -sS -o "$TMP/resp" -w "HTTP %{http_code}\n" \
  -X POST "$WORKER_URL/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" --data-binary "@$TMP/v1.html"
cat "$TMP/resp"; echo
RANDOM_ID=$(python3 -c "import json,sys;print(json.load(open('$TMP/resp'))['id'])" 2>/dev/null || echo "")
[[ -n "$RANDOM_ID" ]] && printf "${G}Random ID: %s${D}\n" "$RANDOM_ID"

# 10. 200 custom hash + 30 days
echo "--- Custom hash + 30 days ---"
curl -sS -o "$TMP/resp" -w "HTTP %{http_code}\n" \
  -X POST "$WORKER_URL/upload?ttl=30&hash=test-artifact-v1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" --data-binary "@$TMP/v1.html"
cat "$TMP/resp"; echo

# 11. Overwrite (same hash)
echo "--- Overwrite: upload v2 with the same hash ---"
curl -sS -o "$TMP/resp" -w "HTTP %{http_code}\n" \
  -X POST "$WORKER_URL/upload?ttl=30&hash=test-artifact-v1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" --data-binary "@$TMP/v2.html"
cat "$TMP/resp"; echo

echo
echo "===== R2 R2 write verification (bypasses the CDN, goes through the Cloudflare API) ====="

# Use wrangler r2 object get to verify the file was actually written to R2
if [[ -n "$RANDOM_ID" ]]; then
  echo "--- Verify the random-ID file exists: 7d/$RANDOM_ID.html ---"
  npx wrangler r2 object get "cloud-artifacts/7d/$RANDOM_ID.html" --remote --file "$TMP/got.html" 2>&1 | tail -5
  echo "Downloaded content:" ; cat "$TMP/got.html" 2>/dev/null
fi

echo "--- Verify test-artifact-v1 has the v2 content after overwrite ---"
npx wrangler r2 object get "cloud-artifacts/30d/test-artifact-v1.html" --remote --file "$TMP/got2.html" 2>&1 | tail -5
echo "Downloaded content:" ; cat "$TMP/got2.html" 2>/dev/null

echo
echo "===== Summary ====="
printf "${G}pass=%d${D} ${R}fail=%d${D}\n" "$pass" "$fail"
[[ "$fail" -gt 0 ]] && exit 1 || exit 0
