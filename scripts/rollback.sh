#!/usr/bin/env bash
#
# Vintrax — roll back to a previously deployed image version.
#
#   ./rollback.sh                   go back to the recorded previous version
#   ./rollback.sh sha-a1b2c3d       go back to a specific version
#   ./rollback.sh --list            show what is available to roll back to
#   ./rollback.sh --help            every option
#
# Rolling back the application is easy. Rolling back the database is not, and
# this script cannot do it: `prisma migrate deploy` only rolls forward.
#
# So this asks one question before it does anything — whether the migrations
# the newer version applied are compatible with the older code. If a migration
# only added a table or a nullable column, the old code ignores it and the
# rollback is safe. If it dropped or renamed something the old code reads, the
# old code will fail against the new schema, and the database has to come back
# from a backup first with restore-db.sh.
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
STATE_DIR=${VINTRAX_STATE_DIR:-$VINTRAX_ROOT/state}
HEALTH_TIMEOUT=${VINTRAX_HEALTH_TIMEOUT:-180}

TARGET=""
LIST=false
ASSUME_YES=false

while (( $# )); do
  case $1 in
    --list) LIST=true; shift ;;
    --yes|-y) ASSUME_YES=true; shift ;;
    --env-file) ENV_FILE=${2:?--env-file needs a path}; shift 2 ;;
    --compose-file) COMPOSE_FILE=${2:?--compose-file needs a path}; shift 2 ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) TARGET=$1; shift ;;
  esac
done

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

CURRENT_FILE="$STATE_DIR/current-version"
PREVIOUS_FILE="$STATE_DIR/previous-version"
CURRENT=$([[ -f $CURRENT_FILE ]] && cat "$CURRENT_FILE" || echo "")

if [[ $LIST == true ]]; then
  step "Rollback targets"
  info "current:  ${CURRENT:-(unknown)}"
  info "previous: $([[ -f $PREVIOUS_FILE ]] && cat "$PREVIOUS_FILE" || echo '(none)')"
  step "Vintrax images held on this machine"
  docker images --format '  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep vintrax- || info "(none)"
  exit 0
fi

[[ -f $ENV_FILE ]] || die "no environment file at $ENV_FILE"
[[ -f $COMPOSE_FILE ]] || die "no compose file at $COMPOSE_FILE"

if [[ -z $TARGET ]]; then
  [[ -f $PREVIOUS_FILE ]] || die "no previous version recorded, so there is nothing to roll back to automatically. Name a version explicitly: $0 sha-a1b2c3d   (--list shows the images on this machine)"
  TARGET=$(cat "$PREVIOUS_FILE")
fi

[[ $TARGET != latest ]] || die "refusing to roll back to 'latest' — it is a moving tag and may already point at the build you are rolling back from"
[[ $TARGET != "$CURRENT" ]] || die "$TARGET is already the current version"

step "Rolling back"
info "from: ${CURRENT:-(unknown)}"
info "to:   $TARGET"

# --- The database question ---------------------------------------------------

step "Database compatibility"

cat <<EOF
    Migrations applied by ${CURRENT:-the current version} are still applied.
    prisma migrate deploy only rolls forward, so this script does not undo them.

    Safe to continue if those migrations only added tables, added nullable
    columns, or added indexes: $TARGET simply does not use them.

    NOT safe if any of them dropped a column, renamed one, made one NOT NULL,
    or changed a type that $TARGET reads. Restore the database from a backup
    first:  ./restore-db.sh <backup-file>
EOF

if [[ $ASSUME_YES != true ]]; then
  read -r -p "    Are the migrations compatible with $TARGET? [y/N] " reply
  [[ $reply == [yY] ]] || die "stopped. Nothing has been changed."
fi

# --- Roll --------------------------------------------------------------------

step "Pulling $TARGET"
VINTRAX_VERSION="$TARGET" compose pull api web mobile ||
  die "could not pull $TARGET — it may have been deleted from the registry"
ok "images for $TARGET are on this machine"

step "Starting $TARGET"
# The migrate service is deliberately skipped. Running it here would apply
# migrations again, which is not what rolling back means.
VINTRAX_VERSION="$TARGET" compose up -d --no-deps --remove-orphans api web mobile

printf '%s\n' "$TARGET" > "$CURRENT_FILE"
# The version we just left becomes the roll-forward target.
[[ -n $CURRENT ]] && printf '%s\n' "$CURRENT" > "$PREVIOUS_FILE"

step "Waiting for health checks (up to ${HEALTH_TIMEOUT}s)"
deadline=$(( SECONDS + HEALTH_TIMEOUT ))
unhealthy=""
while (( SECONDS < deadline )); do
  unhealthy=""
  for svc in api web mobile; do
    cid=$(VINTRAX_VERSION="$TARGET" compose ps -q "$svc" 2>/dev/null || true)
    if [[ -z $cid ]]; then unhealthy+=" $svc(missing)"; continue; fi
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)
    [[ $state == healthy || $state == running ]] || unhealthy+=" $svc($state)"
  done
  [[ -z $unhealthy ]] && break
  sleep 3
done

if [[ -n $unhealthy ]]; then
  warn "${unhealthy# } did not become healthy within ${HEALTH_TIMEOUT}s"
  for entry in $unhealthy; do
    svc=${entry%%(*}
    printf '\n--- %s ---\n' "$svc" >&2
    VINTRAX_VERSION="$TARGET" compose logs --tail 40 "$svc" >&2 || true
  done
  die "rollback to $TARGET did not come up healthy. If the older code is failing against the newer schema, restore the database: ./restore-db.sh <backup-file>"
fi

ok "api, web and mobile are healthy"

step "Rolled back"
info "now running:  $TARGET"
info "roll forward: ./deploy.sh ${CURRENT:-<version>}"
