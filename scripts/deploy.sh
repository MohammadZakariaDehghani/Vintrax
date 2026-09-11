#!/usr/bin/env bash
#
# Vintrax — deploy a published image version to this server.
#
#   ./deploy.sh sha-a1b2c3d         deploy that exact build
#   ./deploy.sh --list              show what is deployed and what it can roll back to
#   ./deploy.sh --help              every option
#
# The server builds nothing. It pulls the images GitHub Actions published to
# GHCR, applies any pending migrations, then rolls the services. The artefact
# that CI verified is the artefact that runs.
#
# What this deliberately does not do:
#
#   It never removes images. The previous version has to still be on disk for
#   rollback.sh to work, so there is no prune here, and `docker system prune -a`
#   is never the right way to reclaim space on this machine.
#
#   It never touches volumes. `docker compose down -v` destroys the database.
#
#   It never rolls back on its own. A failed deployment may have already
#   applied a migration, and starting the previous image against the new schema
#   is how a bad deploy becomes a data-loss incident. It stops, says what
#   failed, and leaves the decision to a person who can look at the migration.
#
set -Eeuo pipefail

C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
C_RED=$'\033[31m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
if [[ ! -t 1 ]]; then C_BLUE=; C_GREEN=; C_YELLOW=; C_RED=; C_DIM=; C_BOLD=; C_RESET=; fi

step() { printf '\n%s==>%s %s%s%s\n' "$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '\n%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# --- Layout, all overridable ------------------------------------------------

VINTRAX_ROOT=${VINTRAX_ROOT:-/opt/vintrax}
ENV_FILE=${VINTRAX_ENV_FILE:-$VINTRAX_ROOT/env/vintrax.env}
COMPOSE_FILE=${VINTRAX_COMPOSE_FILE:-$VINTRAX_ROOT/compose/docker-compose.prod.yml}
STATE_DIR=${VINTRAX_STATE_DIR:-$VINTRAX_ROOT/state}
HEALTH_TIMEOUT=${VINTRAX_HEALTH_TIMEOUT:-180}

VERSION=""
LIST=false

while (( $# )); do
  case $1 in
    --list) LIST=true; shift ;;
    --timeout) HEALTH_TIMEOUT=${2:?--timeout needs seconds}; shift 2 ;;
    --env-file) ENV_FILE=${2:?--env-file needs a path}; shift 2 ;;
    --compose-file) COMPOSE_FILE=${2:?--compose-file needs a path}; shift 2 ;;
    # The header comment is the help text, so the two cannot drift apart.
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) VERSION=$1; shift ;;
  esac
done

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# --- Preflight ---------------------------------------------------------------

step "Checking this machine"

command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not installed"
[[ -f $ENV_FILE ]] || die "no environment file at $ENV_FILE — copy .env.production.example there and fill it in"
[[ -f $COMPOSE_FILE ]] || die "no compose file at $COMPOSE_FILE"

# A world-readable file holding the database password and both JWT secrets is
# worth stopping for, not warning about.
perms=$(stat -c '%a' "$ENV_FILE")
if [[ $perms != 600 && $perms != 400 ]]; then
  die "$ENV_FILE is mode $perms and holds live credentials — run: chmod 600 $ENV_FILE"
fi
ok "docker, compose and $ENV_FILE present"

mkdir -p "$STATE_DIR"
CURRENT_FILE="$STATE_DIR/current-version"
PREVIOUS_FILE="$STATE_DIR/previous-version"

if [[ $LIST == true ]]; then
  step "Deployed versions"
  info "current:  $([[ -f $CURRENT_FILE ]] && cat "$CURRENT_FILE" || echo '(unknown)')"
  info "previous: $([[ -f $PREVIOUS_FILE ]] && cat "$PREVIOUS_FILE" || echo '(none — nothing to roll back to)')"
  step "Images on this machine"
  docker images --format '  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep vintrax- || info "(none)"
  exit 0
fi

# --- Validate the requested version -----------------------------------------

step "Validating the requested version"

[[ -n $VERSION ]] || die "no version given — try: $0 sha-a1b2c3d   (./deploy.sh --list shows what is available)"

if [[ $VERSION == latest ]]; then
  die "refusing to deploy 'latest'. It is a moving tag: the next release overwrites it, which leaves nothing to roll back to and no way to say what is running. Deploy an immutable tag such as sha-a1b2c3d."
fi

# Required by the compose file itself. Checking here turns a container that
# exits three seconds in into a message before anything is touched.
missing=()
for var in IMAGE_NAMESPACE APP_URL CORS_ORIGINS DATABASE_URL REDIS_URL \
           JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  grep -qE "^${var}=.+" "$ENV_FILE" || missing+=("$var")
done
(( ${#missing[@]} == 0 )) || die "missing or empty in $ENV_FILE: ${missing[*]}"

# The API refuses to start in production with these, so catch it here instead.
if grep -qE '^JWT_(ACCESS|REFRESH)_SECRET=(dev-only-|CHANGE_ME)' "$ENV_FILE"; then
  die "JWT secrets in $ENV_FILE are still placeholders. Generate real ones: openssl rand -base64 48"
fi
ok "$VERSION is an immutable tag and the environment is complete"

PREVIOUS=$([[ -f $CURRENT_FILE ]] && cat "$CURRENT_FILE" || echo "")
if [[ $PREVIOUS == "$VERSION" ]]; then
  warn "$VERSION is already the recorded current version; redeploying it"
fi

# --- Pull --------------------------------------------------------------------

step "Pulling $VERSION"

# Pull before stopping anything. A registry outage or a typo in the tag then
# fails here, with the current version still serving traffic.
if ! VINTRAX_VERSION="$VERSION" compose pull api web mobile; then
  die "could not pull $VERSION. Check the tag exists in GHCR and that this machine is logged in (docker login ghcr.io)."
fi
ok "images for $VERSION are on this machine"

# --- Migrate -----------------------------------------------------------------

step "Applying database migrations"

info "prisma migrate deploy — applies pending migrations only; never resets, never prompts"
if ! VINTRAX_VERSION="$VERSION" compose run --rm migrate; then
  die "migrations failed. Nothing has been switched over: the previous version is still running and still serving.
       Read the failure above, fix the migration, and deploy again.
       Do NOT roll back before checking whether a migration partially applied."
fi
ok "database schema is up to date"

# --- Roll --------------------------------------------------------------------

step "Starting $VERSION"

# Record the outgoing version first. If this step dies halfway, rollback.sh
# still knows where to go back to.
[[ -n $PREVIOUS && $PREVIOUS != "$VERSION" ]] && printf '%s\n' "$PREVIOUS" > "$PREVIOUS_FILE"
printf '%s\n' "$VERSION" > "$CURRENT_FILE"

VINTRAX_VERSION="$VERSION" compose up -d --remove-orphans
ok "containers started"

# --- Wait for health ---------------------------------------------------------

step "Waiting for health checks (up to ${HEALTH_TIMEOUT}s)"

deadline=$(( SECONDS + HEALTH_TIMEOUT ))
unhealthy=""
while (( SECONDS < deadline )); do
  unhealthy=""
  for svc in api web mobile; do
    cid=$(VINTRAX_VERSION="$VERSION" compose ps -q "$svc" 2>/dev/null || true)
    if [[ -z $cid ]]; then unhealthy+=" $svc(missing)"; continue; fi
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)
    [[ $state == healthy || $state == running ]] || unhealthy+=" $svc($state)"
  done
  [[ -z $unhealthy ]] && break
  sleep 3
done

if [[ -n $unhealthy ]]; then
  printf '\n%serror:%s %s did not become healthy within %ss.\n' "$C_RED" "$C_RESET" "${unhealthy# }" "$HEALTH_TIMEOUT" >&2
  printf '\n%sLast 40 lines from each unhealthy service:%s\n' "$C_BOLD" "$C_RESET" >&2
  for entry in $unhealthy; do
    svc=${entry%%(*}
    printf '\n%s--- %s ---%s\n' "$C_DIM" "$svc" "$C_RESET" >&2
    VINTRAX_VERSION="$VERSION" compose logs --tail 40 "$svc" >&2 || true
  done
  cat >&2 <<EOF

${C_BOLD}What to do next${C_RESET}
  The migration for $VERSION has already been applied. Rolling back the code
  without checking what that migration did is how a bad deploy becomes a
  data-loss incident, so this script will not do it for you.

  1. Read the logs above. Most failures here are a missing or wrong value in
     $ENV_FILE, not a bad image.
  2. If the schema change is backward compatible with $PREVIOUS:
       ./rollback.sh
  3. If it is not, restore from backup before rolling back:
       ./restore-db.sh <backup-file>
EOF
  exit 1
fi

ok "api, web and mobile are healthy"

step "Deployed"
info "version:  $VERSION"
info "previous: ${PREVIOUS:-(none)}"
info "roll back with: ./rollback.sh"
printf '\n'
VINTRAX_VERSION="$VERSION" compose ps --format 'table {{.Service}}\t{{.Status}}'
