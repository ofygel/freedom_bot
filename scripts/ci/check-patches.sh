#!/usr/bin/env bash
set -euo pipefail

rg -q "userLooksLikeExecutor" src/bot/flows/executor/menu.ts
rg -q "SESSION_TTL_SECONDS" src/config/env.ts
[[ -f db/migrations/0007_orders_soft_fk.up.sql ]]
