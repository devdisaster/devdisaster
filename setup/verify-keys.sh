#!/usr/bin/env bash
# Verifies all four API keys with cheap, real calls (IMPLEMENTATION_PLAN §K "verified tonight").
# Usage: ./setup/verify-keys.sh   (reads .env in the repo root)
set -uo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then echo "ERROR: .env not found. cp .env.example .env and fill it in."; exit 1; fi
set -a; source .env; set +a

pass=0; fail=0
check() { # name, expected-ok (0/1), detail
  if [ "$2" = "0" ]; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1 — $3"; fail=$((fail+1)); fi
}

echo "1/4 Devin (GET /v1/sessions)"
out=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer ${DEVIN_API_KEY:-}" \
  "https://api.devin.ai/v1/sessions?limit=1" 2>&1); code=${out##*$'\n'}
[ "$code" = "200" ]; check "Devin API key" $? "HTTP $code: $(echo "$out" | head -1 | cut -c1-200)"

echo "2/4 Anthropic (GET /v1/models)"
out=$(curl -sS -w '\n%{http_code}' -H "x-api-key: ${ANTHROPIC_API_KEY:-}" \
  -H "anthropic-version: 2023-06-01" "https://api.anthropic.com/v1/models?limit=1" 2>&1); code=${out##*$'\n'}
[ "$code" = "200" ]; check "Anthropic API key" $? "HTTP $code: $(echo "$out" | head -1 | cut -c1-200)"

echo "3/4 Context.dev (scrape example.com — uses 1 credit)"
out=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer ${CONTEXT_API_KEY:-}" \
  "https://api.context.dev/v1/web/scrape/markdown?url=https://example.com" 2>&1); code=${out##*$'\n'}
[ "$code" = "200" ]; check "Context.dev API key" $? "HTTP $code: $(echo "$out" | head -1 | cut -c1-200)"

echo "4/4 Stripe test mode (create \$10 test PaymentIntent)"
out=$(curl -sS -w '\n%{http_code}' "https://api.stripe.com/v1/payment_intents" \
  -u "${STRIPE_SECRET_KEY:-}:" -d amount=1000 -d currency=aed -d "payment_method_types[]=card" 2>&1); code=${out##*$'\n'}
[ "$code" = "200" ]; check "Stripe test key" $? "HTTP $code: $(echo "$out" | head -1 | cut -c1-200)"

echo; echo "Result: $pass passed, $fail failed"
exit $fail
