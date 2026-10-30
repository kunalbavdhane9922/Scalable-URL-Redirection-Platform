#!/usr/bin/env bash
# End-to-end smoke test against a running edge (nginx) instance.
#
#   EDGE_URL=http://localhost:8080 ./scripts/smoke.sh
#   ADMIN_API_KEY=... EDGE_URL=https://links.example.com ./scripts/smoke.sh
#
# Exits non-zero on the first failure.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDGE_URL="${EDGE_URL:-http://localhost:8080}"

if [[ -z "${ADMIN_API_KEY:-}" && -f "$ROOT_DIR/.env" ]]; then
  ADMIN_API_KEY="$(grep -E '^ADMIN_API_KEY=' "$ROOT_DIR/.env" | cut -d= -f2- || true)"
fi
ADMIN_API_KEY="${ADMIN_API_KEY:-dev-admin-key}"

if [[ -z "${METRICS_TOKEN:-}" && -f "$ROOT_DIR/.env" ]]; then
  METRICS_TOKEN="$(grep -E '^METRICS_TOKEN=' "$ROOT_DIR/.env" | cut -d= -f2- || true)"
fi

ALIAS="smoke-$(date +%s)"

PASS=0
FAIL=0
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

check() {
  local label="$1"; local actual="$2"; local expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf '  \033[32mPASS\033[0m %-42s %s\n' "$label" "$actual"
    PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m %-42s got %s, want %s\n' "$label" "$actual" "$expected"
    FAIL=$((FAIL + 1))
  fi
}

status() { curl -sS -o "$TMP_DIR/body" -w '%{http_code}' "$@"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s)$1 ?? '')}catch{console.log('')}})"; }

echo "Smoke testing $EDGE_URL"

check "frontend landing page" "$(status "$EDGE_URL/")" "200"
grep -qi '<div id="root"' "$TMP_DIR/body" || { echo "  landing page missing root element"; FAIL=$((FAIL + 1)); }

check "liveness probe" "$(status "$EDGE_URL/health/live")" "200"
check "readiness probe" "$(status "$EDGE_URL/health/ready")" "200"

check "public shorten" "$(status -X POST "$EDGE_URL/api/shorten" -H 'Content-Type: application/json' -d '{"url":"https://example.com/smoke"}')" "201"
CODE="$(json '.shortCode' < "$TMP_DIR/body")"
SHORT_URL="$(json '.shortUrl' < "$TMP_DIR/body")"
[[ -n "$CODE" ]] || { echo "  no shortCode returned"; exit 1; }
echo "     created /$CODE"

check "redirect 302" "$(status -o /dev/null "$EDGE_URL/$CODE")" "302"
LOCATION="$(curl -sSI "$EDGE_URL/$CODE" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
check "redirect target" "$LOCATION" "https://example.com/smoke"

check "custom alias" "$(status -X POST "$EDGE_URL/api/shorten" -H 'Content-Type: application/json' -d "{\"url\":\"https://example.com/alias\",\"customAlias\":\"$ALIAS\"}")" "201"
check "reserved alias rejected" "$(status -X POST "$EDGE_URL/api/shorten" -H 'Content-Type: application/json' -d '{"url":"https://example.com/other","customAlias":"register"}')" "400"
check "duplicate alias rejected" "$(status -X POST "$EDGE_URL/api/shorten" -H 'Content-Type: application/json' -d "{\"url\":\"https://example.com/other\",\"customAlias\":\"$ALIAS\"}")" "409"
check "alias redirects" "$(status -o /dev/null "$EDGE_URL/$ALIAS")" "302"

check "unknown code 404" "$(status -o /dev/null "$EDGE_URL/does-not-exist-xyz")" "404"

check "management requires key" "$(status "$EDGE_URL/api/links")" "401"
AUTH=(-H "Authorization: Bearer $ADMIN_API_KEY")
check "list links with key" "$(status "${AUTH[@]}" "$EDGE_URL/api/links?limit=5")" "200"
check "platform stats" "$(status "${AUTH[@]}" "$EDGE_URL/api/stats")" "200"

check "retarget link" "$(status -X PATCH "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"url":"https://example.com/updated"}' "$EDGE_URL/api/links/$CODE")" "200"
NEW_LOCATION="$(curl -sSI "$EDGE_URL/$CODE" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
check "redirect reflects update" "$NEW_LOCATION" "https://example.com/updated"

check "disable link" "$(status -X DELETE "${AUTH[@]}" "$EDGE_URL/api/links/$CODE")" "204"
check "disabled link is 410" "$(status -o /dev/null "$EDGE_URL/$CODE")" "410"

# ── Accounts, sessions, and ownership ───────────────────────────────
EMAIL_A="smoke-a-$(date +%s)@example.test"
EMAIL_B="smoke-b-$(date +%s)@example.test"
PASSWORD="smoke-password-12345"
JAR_A="$TMP_DIR/account-a.cookies"
JAR_B="$TMP_DIR/account-b.cookies"

check "providers endpoint" "$(status "$EDGE_URL/api/auth/providers")" "200"
check "me requires a session" "$(status "$EDGE_URL/api/auth/me")" "401"

check "register account" "$(status -c "$JAR_A" -X POST "$EDGE_URL/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\",\"name\":\"Smoke A\"}")" "201"
check "me after register" "$(status -b "$JAR_A" "$EDGE_URL/api/auth/me")" "200"
check "duplicate email rejected" "$(status -X POST "$EDGE_URL/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\"}")" "409"

check "signed-in shorten" "$(status -b "$JAR_A" -c "$JAR_A" -X POST "$EDGE_URL/api/shorten" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/owned"}')" "201"
OWNED_CODE="$(json '.shortCode' < "$TMP_DIR/body")"
check "owned flag returned" "$(json '.owned' < "$TMP_DIR/body")" "true"
[[ -n "$OWNED_CODE" ]] || { echo "  no owned shortCode returned"; exit 1; }
echo "     created owned /$OWNED_CODE"

check "anonymous history requires session" "$(status "$EDGE_URL/api/links")" "401"
check "account history loads" "$(status -b "$JAR_A" "$EDGE_URL/api/links?limit=100")" "200"
if grep -q "$OWNED_CODE" "$TMP_DIR/body"; then HISTORY_STATE="found"; else HISTORY_STATE="missing"; fi
check "history contains owned link" "$HISTORY_STATE" "found"

check "anonymous shorten stays unowned" "$(status -X POST "$EDGE_URL/api/shorten" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/anonymous"}')" "201"
check "unowned flag returned" "$(json '.owned' < "$TMP_DIR/body")" "false"

check "second account register" "$(status -c "$JAR_B" -X POST "$EDGE_URL/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_B\",\"password\":\"$PASSWORD\",\"name\":\"Smoke B\"}")" "201"
check "other user cannot read owned link" "$(status -b "$JAR_B" "$EDGE_URL/api/links/$OWNED_CODE")" "404"
check "other user cannot retarget owned link" "$(status -b "$JAR_B" -X PATCH "$EDGE_URL/api/links/$OWNED_CODE" \
  -H 'Content-Type: application/json' -d '{"url":"https://evil.example/hijack"}')" "404"

EXPIRES_AT="$(node -e 'console.log(new Date(Date.now() + 86400000).toISOString())')"
check "owner sets expiry" "$(status -b "$JAR_A" -X PATCH "$EDGE_URL/api/links/$OWNED_CODE" \
  -H 'Content-Type: application/json' -d "{\"expiresAt\":\"$EXPIRES_AT\"}")" "200"
check "owner clears expiry" "$(status -b "$JAR_A" -X PATCH "$EDGE_URL/api/links/$OWNED_CODE" \
  -H 'Content-Type: application/json' -d '{"expiresAt":null}')" "200"
check "expiry cleared in details" \
  "$(status -b "$JAR_A" "$EDGE_URL/api/links/$OWNED_CODE" >/dev/null; json '.expiresAt' < "$TMP_DIR/body")" ""
check "owned link still redirects" "$(status -o /dev/null "$EDGE_URL/$OWNED_CODE")" "302"

check "logout" "$(status -b "$JAR_A" -c "$JAR_A" -X POST "$EDGE_URL/api/auth/logout")" "204"
check "me after logout" "$(status -b "$JAR_A" "$EDGE_URL/api/auth/me")" "401"
check "wrong password rejected" "$(status -X POST "$EDGE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"not-the-password\"}")" "401"
check "login with password" "$(status -b "$JAR_A" -c "$JAR_A" -X POST "$EDGE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\"}")" "200"
check "me after login" "$(status -b "$JAR_A" "$EDGE_URL/api/auth/me")" "200"

check "forgot password is enumeration-safe" "$(status -X POST "$EDGE_URL/api/auth/forgot-password" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL_A\"}")" "202"
check "unknown email gets same response" "$(status -X POST "$EDGE_URL/api/auth/forgot-password" \
  -H 'Content-Type: application/json' -d '{"email":"nobody-here@example.test"}')" "202"

check "cross-origin write rejected" "$(status -X POST "$EDGE_URL/api/shorten" \
  -H 'Content-Type: application/json' -H 'Origin: https://evil.example' \
  -d '{"url":"https://example.com/csrf"}')" "403"

if [[ -n "${METRICS_TOKEN:-}" ]]; then
  check "metrics with token" "$(status -H "X-Metrics-Token: $METRICS_TOKEN" "$EDGE_URL/metrics")" "200"
fi

echo
if (( FAIL > 0 )); then
  printf '\033[31m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
  exit 1
fi
printf '\033[32mAll %d checks passed\033[0m\n' "$PASS"
