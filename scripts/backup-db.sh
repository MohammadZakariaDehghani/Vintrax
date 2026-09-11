#!/usr/bin/env bash
#
# Vintrax — back up the PostgreSQL database.
#
#   ./backup-db.sh                     write a timestamped dump
#   ./backup-db.sh --prune             also delete dumps past the retention window
#   ./backup-db.sh --retention-days 30 set that window (default 14)
#   ./backup-db.sh --list              show what has been kept
#   ./backup-db.sh --help              every option
#
# Dumps go to /opt/vintrax/backups as vintrax-YYYYmmdd-HHMMSS.sql.gz.
#
# Old dumps are NEVER deleted unless --prune is passed explicitly. A backup
# script that quietly enforces a retention policy nobody chose is a backup
# script that deletes the dump you needed, so pruning is opt-in and says what it
# is about to remove.
#
# Run it from cron before each deployment and nightly:
#   0 3 * * *  /opt/vintrax/scripts/backup-db.sh --prune >> /var/log/vintrax-backup.log 2>&1
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
RETENTION_DAYS=14
PRUNE=false
LIST=false

while (( $# )); do
  case $1 in
    --prune) PRUNE=true; shift ;;
    --retention-days) RETENTION_DAYS=${2:?--retention-days needs a number}; shift 2 ;;
    --list) LIST=true; shift ;;
    --dir) BACKUP_DIR=${2:?--dir needs a path}; shift 2 ;;
    --env-file) ENV_FILE=${2:?--env-file needs a path}; shift 2 ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

mkdir -p "$BACKUP_DIR"

if [[ $LIST == true ]]; then
  step "Backups in $BACKUP_DIR"
  ls -lh "$BACKUP_DIR"/vintrax-*.sql.gz 2>/dev/null | awk '{printf "    %s  %s %s %s\n", $9, $6, $7, $5}' || info "(none)"
  exit 0
fi

[[ -f $ENV_FILE ]] || die "no environment file at $ENV_FILE"
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

step "Backing up the database"

STAMP=$(date -u +%Y%m%d-%H%M%S)
TARGET="$BACKUP_DIR/vintrax-$STAMP.sql.gz"
TMP="$TARGET.partial"

# Written to .partial and renamed only on success, so an interrupted dump can
# never be mistaken for a good one by restore-db.sh or by a person in a hurry.
if compose ps --services 2>/dev/null | grep -qx postgres; then
  info "source: the bundled postgres container"
  # --clean --if-exists so the dump can be restored over an existing database.
  compose exec -T postgres pg_dump \
      --username "${POSTGRES_USER:?POSTGRES_USER is not set}" \
      --dbname "${POSTGRES_DB:?POSTGRES_DB is not set}" \
      --clean --if-exists --no-owner --no-privileges \
    | gzip -9 > "$TMP"
else
  info "source: DATABASE_URL (managed database)"
  command -v pg_dump >/dev/null ||
    die "pg_dump is not installed on this host, and PostgreSQL is not running in this stack. Install the client: sudo apt-get install -y postgresql-client"
  pg_dump --clean --if-exists --no-owner --no-privileges \
      --dbname "${DATABASE_URL:?DATABASE_URL is not set}" \
    | gzip -9 > "$TMP"
fi

# A dump of nothing is the failure mode that goes unnoticed for a month.
size=$(stat -c '%s' "$TMP")
(( size > 1024 )) || { rm -f "$TMP"; die "the dump is only ${size} bytes, which cannot be a real database. Nothing was kept."; }

mv "$TMP" "$TARGET"
chmod 600 "$TARGET"
ok "$TARGET ($(numfmt --to=iec "$size" 2>/dev/null || echo "$size bytes"))"

# --- Retention ---------------------------------------------------------------

if [[ $PRUNE == true ]]; then
  step "Pruning backups older than $RETENTION_DAYS days"
  mapfile -t stale < <(find "$BACKUP_DIR" -maxdepth 1 -name 'vintrax-*.sql.gz' -mtime "+$RETENTION_DAYS" -print | sort)
  if (( ${#stale[@]} == 0 )); then
    info "nothing older than $RETENTION_DAYS days"
  else
    # Never prune down to nothing, however old everything is.
    total=$(find "$BACKUP_DIR" -maxdepth 1 -name 'vintrax-*.sql.gz' | wc -l)
    if (( total - ${#stale[@]} < 1 )); then
      warn "every backup is older than $RETENTION_DAYS days; keeping the most recent one rather than leaving none"
      unset 'stale[${#stale[@]}-1]'
    fi
    for f in "${stale[@]}"; do info "removing $(basename "$f")"; rm -f "$f"; done
    ok "pruned ${#stale[@]} backup(s)"
  fi
else
  info "old backups kept — pass --prune to apply the $RETENTION_DAYS-day retention policy"
fi

step "Done"
info "restore with: ./restore-db.sh $TARGET"
