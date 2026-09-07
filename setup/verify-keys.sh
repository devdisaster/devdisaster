#!/usr/bin/env bash
# Verifies the three vendor API keys with cheap, real calls.
# Usage: ./setup/verify-keys.sh
# Keys are read from the environment, or from a local .env if you keep one.
# The deployment's copy of these keys lives in Convex: npx convex env set NAME value
set -uo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; source .env; set +a; fi

missing=""
for name in DEVIN_API_KEY ANTHROPIC_API_KEY CONTEXT_API_KEY; do
  [ -n "${!name:-}" ] || missing="$missing $name"
done
if [ -n "$missing" ]; then
  echo "ERROR: not set:$missing"
  echo "Export them, or put them in a local .env (gitignored). See .env.example."
  exit 1
fi

pass=0; fail=0
check() { # name, expected-ok (0/1), detail
  if [ "$2" = "0" ]; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1 — $3"; fail=$((fail+1)); fi
}

echo "1/3 Devin (GET /v1/sessions)"
out=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer ${DEVIN_API_KEY:-}" \
  "https://api.devin.ai/v1/sessions?limit=1" 2>&1); code=${out##*$'\n'}
[ "$code" = "200" ]; check "Devin API key" $? "HTTP $code: $(echo "$out" | head -1 | cut -c1-200)"

echo "2/3 Anthropic (GET /v1/models)"
out=$(curl -sS -w '\n%{http_code}' -H "x-api-key: ${ANTHROPIC_API_KEY:-}" \
  -H "anthropic-version: 2023-06-01" "https://api.anthropic.com/v1/models?limit=1" 2>&1); code=${out##*$'\n'}
[ "$code" = "200" ]; check "Anthropic API key" $? "HTTP $code: $(echo "$out" | head -1 | cut -c1-200)"

echo "3/3 Context.dev (scrape example.com — uses 1 credit)"
out=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer ${CONTEXT_API_KEY:-}" \
  "https://api.context.dev/v1/web/scrape/markdown?url=https://example.com" 2>&1); code=${out##*$'\n'}
[ "$code" = "200" ]; check "Context.dev API key" $? "HTTP $code: $(echo "$out" | head -1 | cut -c1-200)"

echo; echo "Result: $pass passed, $fail failed"
exit $fail
