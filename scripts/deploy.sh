#!/usr/bin/env bash
#
# Vintrax — deploy a published image version to this server.
#
#   ./deploy.sh sha-a1b2c3d         deploy that exact build
#   ./deploy.sh --list              show what is deployed and what it can roll back to
#   ./deploy.sh --clean-images      apply the image retention below now, without deploying
#   ./deploy.sh --clean-images --dry-run
#                                   say what it would remove, and remove nothing
#   ./deploy.sh --help              every option
#
# The server builds nothing. It pulls the images GitHub Actions published to
# GHCR, applies any pending migrations, then rolls the services. The artefact
# that CI verified is the artefact that runs.
#
# What this deliberately does not do:
#
#   It never prunes. After a deployment passes its health checks it removes
#   old builds of exactly three repositories (vintrax-api, vintrax-web and
#   vintrax-mobile, named by the compose file) and keeps the newest 3 sha-
#   versions of each, so rollback.sh still has recent versions on disk. It
#   never removes an image any container uses, the version just deployed or
#   the recorded previous version; never forces a removal; and never touches
#   any other image (postgres, redis, ...), dangling images, volumes or
#   networks. `docker system prune -a` is still never the right way to reclaim
#   space on this machine. VINTRAX_IMAGE_KEEP changes the 3. A cleanup that
#   fails is reported, and the deployment still counts as successful.
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

IMAGE_KEEP=${VINTRAX_IMAGE_KEEP:-3}

VERSION=""
LIST=false
CLEAN_ONLY=false
DRY_RUN=false

while (( $# )); do
  case $1 in
    --list) LIST=true; shift ;;
    --clean-images) CLEAN_ONLY=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
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

[[ $IMAGE_KEEP =~ ^[1-9][0-9]*$ ]] || die "VINTRAX_IMAGE_KEEP must be a whole number of at least 1, not '$IMAGE_KEEP'"
[[ $DRY_RUN == false || $CLEAN_ONLY == true ]] || die "--dry-run only applies to --clean-images"

# --- Old image cleanup -------------------------------------------------------
#
# Removes old sha- builds of the three Vintrax application images and keeps
# the newest $IMAGE_KEEP of each (newest by image creation time, which is build
# order). Runs only after a deployment is healthy, or on --clean-images. It
# runs in a subshell under `if`, so nothing in here can fail the deployment:
# every error is reported and the function returns non-zero.
#
# Never removed: an image any container (running or stopped) uses, the
# version passed in, the recorded previous version, any tag that is not
# sha-<hex> (so never `latest` and never a dangling image), and anything
# outside the three repositories. Removal is `docker image rm` by name, without
# --force, so Docker itself also refuses an image that is still in use.

cleanup_old_images() {
  local protect_version=$1 previous="" refs ref repo lines tag id created epoch n
  local -a repos=() keep_tags=() also_kept=() remove_refs=() in_use=()
  local failed=false

  [[ -f $PREVIOUS_FILE ]] && previous=$(<"$PREVIOUS_FILE")

  # The repository names come from compose, reading the same env file the
  # deployment read, so REGISTRY and IMAGE_NAMESPACE (spelling included) are
  # exactly the ones the running containers were started from.
  if ! refs=$(VINTRAX_VERSION="$protect_version" compose config --images 2>&1); then
    printf '%s\n' "$refs" >&2
    warn "could not read the image names from $COMPOSE_FILE; nothing was removed"
    return 1
  fi
  while IFS= read -r ref; do
    repo=${ref%:*}
    [[ $repo =~ ^[a-z0-9.:-]+(/[a-z0-9._-]+)+/vintrax-(api|web|mobile)$ ]] || continue
    [[ " ${repos[*]} " == *" $repo "* ]] || repos+=("$repo")
  done <<< "$refs"
  if (( ${#repos[@]} != 3 )); then
    warn "expected the vintrax-api, vintrax-web and vintrax-mobile images in $COMPOSE_FILE, found: ${repos[*]:-(none)}; nothing was removed"
    return 1
  fi

  # Every image any container uses, by full image ID. If this cannot be read,
  # nothing is safe to remove.
  local ids
  if ! ids=$(docker ps -aq) ||
     { [[ -n $ids ]] && ! ids=$(docker inspect -f '{{.Image}}' $ids); }; then
    warn "could not list the images containers use; nothing was removed"
    return 1
  fi
  mapfile -t in_use <<< "$ids"
  if [[ -z ${in_use[0]:-} ]]; then
    warn "no container reports using an image, which is not expected after a deploy; nothing was removed"
    return 1
  fi

  for repo in "${repos[@]}"; do
    # "<created epoch> <tag> <image id>", newest first, sha- tags only.
    local ranked=""
    if ! lines=$(docker images "$repo" --no-trunc --format '{{.Tag}} {{.ID}}'); then
      warn "could not list the images of $repo; skipped it"
      failed=true; continue
    fi
    while read -r tag id; do
      [[ $tag =~ ^sha-[0-9a-f]{7,40}$ ]] || continue
      if ! created=$(docker image inspect -f '{{.Created}}' "$repo:$tag") ||
         ! epoch=$(date -d "$created" +%s); then
        warn "could not read when $repo:$tag was built; skipped $repo"
        failed=true; continue 2
      fi
      ranked+="$epoch $tag $id"$'\n'
    done <<< "$lines"
    ranked=$(printf '%s' "$ranked" | sort -k1,1nr -k2,2r)

    n=0
    while read -r epoch tag id; do
      [[ -n $tag ]] || continue
      n=$(( n + 1 ))
      if (( n <= IMAGE_KEEP )); then
        [[ " ${keep_tags[*]} " == *" $tag "* ]] || keep_tags+=("$tag")
      elif [[ " ${in_use[*]} " == *" $id "* ]]; then
        also_kept+=("$repo:$tag (a container uses it)")
      elif [[ $tag == "$protect_version" ]]; then
        also_kept+=("$repo:$tag (the version just deployed)")
      elif [[ $tag == "$previous" ]]; then
        also_kept+=("$repo:$tag (the recorded previous version, for rollback.sh)")
      else
        remove_refs+=("$repo:$tag")
      fi
    done <<< "$ranked"
  done

  printf 'Keeping latest %s Vintrax versions:\n' "$IMAGE_KEEP"
  if (( ${#keep_tags[@]} )); then printf '  %s\n' "${keep_tags[@]}"; else printf '  (no sha- images found)\n'; fi

  if (( ${#also_kept[@]} )); then
    printf 'Also keeping, although older:\n'
    printf '  %s\n' "${also_kept[@]}"
  fi

  if (( ${#remove_refs[@]} == 0 )); then
    printf 'No old Vintrax images to remove.\n'
  elif [[ $DRY_RUN == true ]]; then
    printf 'Would remove old Vintrax image (dry run, nothing removed):\n'
    printf '  %s\n' "${remove_refs[@]}"
    return 0
  else
    printf 'Removing old Vintrax image:\n'
  fi
  for ref in "${remove_refs[@]}"; do
    printf '  %s\n' "$ref"
    # No --force: if Docker says the image is in use, it stays.
    if ! docker image rm "$ref" >/dev/null; then
      warn "could not remove $ref; left it in place"
      failed=true
    fi
  done

  [[ $failed == false ]]
}

run_image_cleanup() {
  printf '\nStarting Docker image cleanup...\n'
  if ( cleanup_old_images "$1" ); then
    printf 'Docker image cleanup completed.\n'
  else
    warn "Docker image cleanup did not finish (errors above). Old images may remain; the deployment is not affected."
  fi
}

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

if [[ $CLEAN_ONLY == true ]]; then
  [[ -z $VERSION ]] || die "--clean-images takes no version; it protects the recorded current version"
  [[ -s $CURRENT_FILE ]] || die "no current version recorded in $CURRENT_FILE, so there is nothing to measure \"old\" against"
  run_image_cleanup "$(<"$CURRENT_FILE")"
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

# Only reached when every service is healthy: the failure paths above exit.
printf '\nDeployment successful: %s\n' "$VERSION"
run_image_cleanup "$VERSION"
