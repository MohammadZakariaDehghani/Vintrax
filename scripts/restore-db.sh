#!/usr/bin/env bash
#
# Vintrax — restore the PostgreSQL database from a backup.
#
#   ./restore-db.sh backups/vintrax-20260911-030000.sql.gz
#   ./restore-db.sh --list                  show available backups
#   ./restore-db.sh --help                  every option
#
# THIS OVERWRITES THE DATABASE. The dumps are taken with --clean --if-exists,
# so restoring drops every existing table before recreating it. Everything
# written since the backup was taken is gone.
#
# Because of that it does three things first: it stops the application so
# nothing writes during the restore, it takes a safety dump of the current
# state so a mistaken restore is itself recoverable, and it asks you to type
# the word RESTORE. There is no --force.
#
set -Eeuo pipefail

C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
C_RED=$'\033[31m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
if [[ ! -t 1 ]]; then C_BLUE=; C_GREEN=; C_YELLOW=; C_RED=; C_BOLD=; C_RESET=; fi

step() { printf '\n%s==>%s %s%s%s\n' "$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '\n%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

VINTRAX_ROOT=${VINTRAX_ROOT:-/opt/vintrax}
ENV_FILE=${VINTRAX_ENV_FILE:-$VINTRAX_ROOT/env/vintrax.env}
COMPOSE_FILE=${VINTRAX_COMPOSE_FILE:-$VINTRAX_ROOT/compose/docker-compose.prod.yml}
BACKUP_DIR=${VINTRAX_BACKUP_DIR:-$VINTRAX_ROOT/backups}
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

ARCHIVE=""
while (( $# )); do
  case $1 in
    --list)
      printf 'Backups in %s\n' "$BACKUP_DIR"
      ls -lh "$BACKUP_DIR"/vintrax-*.sql.gz 2>/dev/null | awk '{printf "  %s  %s %s %s\n", $9, $6, $7, $5}' || echo "  (none)"
      exit 0 ;;
    --env-file) ENV_FILE=${2:?--env-file needs a path}; shift 2 ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) ARCHIVE=$1; shift ;;
  esac
done

[[ -n $ARCHIVE ]] || die "no backup file given — try: $0 --list"
[[ -f $ARCHIVE ]] || die "no such file: $ARCHIVE"
[[ $ARCHIVE != *.partial ]] || die "$ARCHIVE is an interrupted dump, not a complete backup"
gzip -t "$ARCHIVE" 2>/dev/null || die "$ARCHIVE is not a valid gzip file — it is truncated or corrupt, and restoring from it would leave the database in a half-dropped state"
[[ -f $ENV_FILE ]] || die "no environment file at $ENV_FILE"

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

BUNDLED=false
compose ps --services 2>/dev/null | grep -qx postgres && BUNDLED=true

step "About to restore"
info "from: $ARCHIVE ($(stat -c '%s' "$ARCHIVE" | numfmt --to=iec 2>/dev/null || echo '?'))"
info "into: $([[ $BUNDLED == true ]] && echo "the bundled postgres container (${POSTGRES_DB:-?})" || echo 'the database named by DATABASE_URL')"
printf '\n    %sThis drops every existing table and replaces it. Everything written\n    since this backup was taken will be lost.%s\n\n' "$C_YELLOW" "$C_RESET"

read -r -p "    Type RESTORE to continue: " reply
[[ $reply == RESTORE ]] || die "stopped. Nothing has been changed."

# --- Stop writers -------------------------------------------------------------

step "Stopping the application"
# The API only. PostgreSQL has to stay up to be restored into, and stopping the
# web tier is not necessary — with no API it has nothing to write through.
compose stop api 2>/dev/null || true
ok "api stopped; nothing is writing to the database"

# --- Safety dump --------------------------------------------------------------

step "Taking a safety dump of the current state first"
if "$SCRIPT_DIR/backup-db.sh" --dir "$BACKUP_DIR" --env-file "$ENV_FILE" >/dev/null 2>&1; then
  ok "current state saved to $BACKUP_DIR (restoring the wrong file is now recoverable)"
else
  warn "could not take a safety dump — the database may already be unreachable"
  read -r -p "    Continue without one? [y/N] " reply
  [[ $reply == [yY] ]] || { compose start api >/dev/null 2>&1 || true; die "stopped. Nothing has been changed."; }
fi

# --- Restore -------------------------------------------------------------------

step "Restoring"
if [[ $BUNDLED == true ]]; then
  gunzip -c "$ARCHIVE" | compose exec -T postgres psql \
    --username "${POSTGRES_USER:?}" --dbname "${POSTGRES_DB:?}" \
    --quiet --set ON_ERROR_STOP=on
else
  command -v psql >/dev/null || die "psql is not installed on this host: sudo apt-get install -y postgresql-client"
  gunzip -c "$ARCHIVE" | psql --dbname "${DATABASE_URL:?}" --quiet --set ON_ERROR_STOP=on
fi
ok "database restored from $(basename "$ARCHIVE")"

# --- Restart --------------------------------------------------------------------

step "Starting the application"
compose start api
ok "api started"

cat <<EOF

${C_BOLD}Check before you walk away${C_RESET}
    docker compose -f $COMPOSE_FILE logs -f api
    curl -fsS http://127.0.0.1:\${API_BIND_PORT:-3001}/api/health

If the restored schema is older than the running image expects, apply the
migrations it is missing:
    docker compose --env-file $ENV_FILE -f $COMPOSE_FILE run --rm migrate
EOF
