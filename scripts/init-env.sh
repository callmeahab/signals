#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo '.env already exists; keeping it.'
  exit 0
fi
read -r -p 'Owner email: ' signals_email
read -r -s -p 'Owner password (12+ characters): ' signals_password
echo
if [ "${#signals_password}" -lt 12 ]; then
  echo 'Password must have at least 12 characters.' >&2
  exit 1
fi
umask 077
export signals_email signals_password
python3 - <<'PY'
import os, secrets, json
from pathlib import Path
values = dict(DATABASE_URL='postgres://signals:signals@localhost:8432/signals',
              SIGNALS_BIND='0.0.0.0:8300', SIGNALS_PUBLIC_URL='http://localhost:8300',
              SIGNALS_CORS_ORIGINS='http://127.0.0.1:8300',
              SIGNALS_ADMIN_TOKEN=secrets.token_hex(32), SIGNALS_SESSION_SECRET=secrets.token_hex(32),
              SIGNALS_BOOTSTRAP_EMAIL=os.environ['signals_email'],
              SIGNALS_BOOTSTRAP_PASSWORD=os.environ['signals_password'])
Path('.env').write_text(''.join(f'{key}={json.dumps(value.replace("$", "$$"))}\n' for key,value in values.items()))
PY
echo 'Created .env. Run docker compose up --build.'
