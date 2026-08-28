#!/usr/bin/env bash
set -Eeuo pipefail

readonly STACK_ENV="${CMRMPR_STACK_ENV:-/mnt/bunker/CMRMPR/supabase-local/.env}"

if [[ ! -r "$STACK_ENV" ]]; then
  echo "Cannot read the local Supabase environment: $STACK_ENV" >&2
  exit 1
fi

cmr_anon_key=$(sed -n 's/^ANON_KEY=//p' "$STACK_ENV")
if [[ -z "$cmr_anon_key" ]]; then
  echo "ANON_KEY is missing from $STACK_ENV" >&2
  exit 1
fi

# A documentação da infraestrutura exige que uma publicação só avance sem
# erros TypeScript e sem vulnerabilidades de nível alto/crítico. Antes isto
# dependia de alguém se lembrar de correr estes dois comandos à mão; agora
# fazem parte do próprio build:local e bloqueiam a publicação se falharem.
echo "A verificar tipos TypeScript (tsc --noEmit)..." >&2
./node_modules/.bin/tsc --noEmit

echo "A verificar vulnerabilidades de dependências (npm audit)..." >&2
npm audit --omit=dev --audit-level=high

VITE_BASE_PATH=/ \
VITE_SUPABASE_URL_CMR=https://cmr.mpr.pt \
VITE_SUPABASE_KEY_CMR="$cmr_anon_key" \
VITE_DISABLE_SUPABASE_IMPORT=true \
VITE_SUPABASE_URL_IMPORT= \
VITE_SUPABASE_KEY_IMPORT= \
exec ./node_modules/.bin/vite build
