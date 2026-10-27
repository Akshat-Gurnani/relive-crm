#!/bin/sh
# Starts the whole CRM on this computer with no Docker and no cloud account:
#   Postgres (private copy in ~/.relive-crm-local)  ->  gateway (login + API on :54321)  ->  web app on :3000
# First run loads the schema and demo data. Press Ctrl-C to stop everything.
#   ./start.sh            start (keeps your data between runs)
#   ./start.sh --reset    wipe the local database and reload the demo data
#   ./start.sh --lan      also open it to phones on the same Wi-Fi (for testing the mobile app)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
STATE="${CRM_LOCAL_HOME:-$HOME/.relive-crm-local}"
DATA="$STATE/pgdata"
PGPORT="${CRM_PG_PORT:-54322}"
WEBPORT="${CRM_WEB_PORT:-3000}"
mkdir -p "$STATE"

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js is not installed (https://nodejs.org)."
command -v npm  >/dev/null 2>&1 || die "npm is not installed."

# --- find Postgres programs (any of these locations, or set PGBIN yourself)
if [ -z "$PGBIN" ]; then
  for c in "$(brew --prefix postgresql@16 2>/dev/null)/bin" "$(brew --prefix postgresql@17 2>/dev/null)/bin" "$(brew --prefix postgresql@15 2>/dev/null)/bin" \
           /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@17/bin \
           /Applications/Postgres.app/Contents/Versions/latest/bin /usr/lib/postgresql/16/bin; do
    if [ -x "$c/initdb" ] && [ -x "$c/pg_ctl" ]; then PGBIN="$c"; break; fi
  done
fi
[ -n "$PGBIN" ] || die "Postgres programs not found. Install them once with:  brew install postgresql@16"

for a in "$@"; do
  case "$a" in
    --reset) rm -f "$STATE/loaded" ;;
    --lan) export CRM_LAN=1 ;;
  esac
done
export CRM_LOCAL_HOME="$STATE"

# --- private Postgres cluster
if [ ! -f "$DATA/PG_VERSION" ]; then
  say "Creating a private Postgres database folder in $DATA"
  "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 >/dev/null
  rm -f "$STATE/loaded"
fi
if ! "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  say "Starting Postgres on port $PGPORT"
  "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -k /tmp" -l "$STATE/postgres.log" -w start >/dev/null \
    || { tail -20 "$STATE/postgres.log"; die "Postgres did not start (is port $PGPORT busy?)."; }
  STARTED_PG=1
fi

cleanup() {
  printf '\n== Stopping\n'
  [ -n "$GW_PID" ] && kill "$GW_PID" 2>/dev/null || true
  [ -n "$STARTED_PG" ] && "$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# --- dependencies
if [ ! -d "$HERE/node_modules" ] || [ "$HERE/package.json" -nt "$HERE/node_modules/.package-lock.json" ]; then
  say "Installing local stack packages"; (cd "$HERE" && npm install --no-audit --no-fund --silent)
fi
if [ ! -d "$ROOT/web/node_modules" ] || [ "$ROOT/web/package.json" -nt "$ROOT/web/node_modules/.package-lock.json" ]; then
  say "Installing web app packages (a minute or two the first time)"; (cd "$ROOT/web" && npm install --no-audit --no-fund --silent)
fi

export CRM_DB_ADMIN_URL="postgres://postgres@127.0.0.1:$PGPORT/postgres"

# --- schema and demo data (first run, or after --reset)
if [ ! -f "$STATE/loaded" ]; then
  say "Loading the schema and demo data"
  (cd "$HERE" && node setup-db.mjs) || die "Loading the database failed."
  touch "$STATE/loaded"
fi

# --- gateway
say "Starting the login and API gateway on port 54321"
(cd "$HERE" && node gateway.mjs --print-keys > "$STATE/gateway.log" 2>&1) &
GW_PID=$!
i=0; until grep -q ANON_KEY "$STATE/gateway.log" 2>/dev/null; do
  i=$((i+1)); [ $i -gt 40 ] && { cat "$STATE/gateway.log"; die "Gateway did not start (is port 54321 busy?)."; }
  sleep 0.5
done
key() { grep "^$1=" "$STATE/gateway.log" | cut -d= -f2; }
until grep -q VAPID_PUBLIC_KEY "$STATE/gateway.log" 2>/dev/null; do sleep 0.3; done
{
  echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(key ANON_KEY)"
  echo "SUPABASE_SERVICE_ROLE_KEY=$(key SERVICE_KEY)"
  echo "NEXT_PUBLIC_VAPID_PUBLIC_KEY=$(key VAPID_PUBLIC_KEY)"
} > "$ROOT/web/.env.local"
LANIP=""
if [ -n "$CRM_LAN" ]; then
  LANIP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
  echo "CRM_GATEWAY_LAN_URL=http://$LANIP:54321" >> "$ROOT/web/.env.local"
fi

cat <<MSG

  Relive CRM is starting at http://localhost:$WEBPORT
  Demo logins (password for all: demo1234)
    admin@relive.test          admin: sees everything
    manager.lko@relive.test    manager: Lucknow team
    priya@relive.test          agent: only her own leads
    marketing@relive.test      marketing: aggregates only, no names or phones
  Press Ctrl-C to stop.
MSG
[ -n "$LANIP" ] && printf '  On a phone on the same Wi-Fi: http://%s:%s   (mobile app server: http://%s:54321)\n\n' "$LANIP" "$WEBPORT" "$LANIP"
cat <<MSG
MSG
[ -n "$NO_BROWSER" ] || (sleep 6; command -v open >/dev/null 2>&1 && open "http://localhost:$WEBPORT") &
cd "$ROOT/web" && if [ -n "$CRM_LAN" ]; then npx next dev -H 0.0.0.0 -p "$WEBPORT"; else npx next dev -p "$WEBPORT"; fi
