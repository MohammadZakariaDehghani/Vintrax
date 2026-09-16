import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Compose is deployment configuration, and it is where a laptop-safe default
 * quietly becomes an internet-facing one. Docker publishes ports through its
 * own NAT rules, ahead of the host firewall, so `5432:5432` on a machine with
 * a public interface is a database on the internet whether or not ufw is on.
 *
 * The file is read as text and sliced by indentation rather than parsed: no
 * YAML library is a dependency here, and adding one to assert four lines would
 * cost more than it proves.
 */

const COMPOSE_PATH = join(__dirname, '..', '..', 'docker-compose.yml');
const compose = readFileSync(COMPOSE_PATH, 'utf8');

/** The lines belonging to one service, from its key to the next sibling key. */
function serviceBlock(name: string): string {
  const lines = compose.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) throw new Error(`docker-compose.yml has no service "${name}"`);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Port mappings published by a service, as written. */
function publishedPorts(name: string): string[] {
  const block = serviceBlock(name);
  const ports = block.match(/^ {4}ports:\n((?: {6}- .*\n?)+)/m);
  if (!ports) return [];
  return [...ports[1]!.matchAll(/- '([^']+)'/g)].map((match) => match[1]!);
}

/** Services holding data or credentials. None of these belongs on 0.0.0.0. */
const BACKING_SERVICES = ['postgres', 'redis', 'minio', 'opensearch'];

/** Services a reverse proxy or another host has to reach. */
const PUBLIC_SERVICES = ['api', 'web', 'mobile'];

describe('published ports', () => {
  it.each(BACKING_SERVICES)('binds %s to loopback only', (name) => {
    const ports = publishedPorts(name);

    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) {
      expect(mapping).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it.each(PUBLIC_SERVICES)('leaves %s reachable, because something must reach it', (name) => {
    const ports = publishedPorts(name);

    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) {
      expect(mapping).not.toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('reads the real file, not an empty one', () => {
    expect(compose).toContain('services:');
    expect(publishedPorts('postgres')).toEqual(['127.0.0.1:5432:5432']);
  });
});

describe('redis', () => {
  const redis = serviceBlock('redis');

  it('requires a password', () => {
    // Unauthenticated Redis is not merely a readable cache — a client can
    // rewrite the RDB path and have the server write a file wherever it can.
    expect(redis).toContain('--requirepass');
  });

  it('takes that password from the environment rather than hard-coding one', () => {
    expect(redis).toMatch(/--requirepass\n\s+- \$\{REDIS_PASSWORD/);
  });

  it('health-checks as an authenticated client, so a healthy container is a usable one', () => {
    expect(redis).toMatch(/healthcheck:[\s\S]*'-a'/);
  });

  it('is addressed by the API with that password', () => {
    // redis://:PASSWORD@host — the empty username is how a Redis URL carries a
    // requirepass secret.
    expect(serviceBlock('api')).toMatch(/REDIS_URL: redis:\/\/:\$\{REDIS_PASSWORD[^@]*@redis:6379/);
  });
});

describe('postgres', () => {
  it('takes its password from the environment rather than hard-coding one', () => {
    expect(serviceBlock('postgres')).toContain('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD');
  });
});

describe('the example environment', () => {
  const env = readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf8');

  it('ships a REDIS_URL that carries a password, matching the compose default', () => {
    expect(env).toMatch(/^REDIS_URL="redis:\/\/:[^@]+@/m);
  });

  it('names REDIS_PASSWORD, so compose and the URL cannot drift apart silently', () => {
    expect(env).toMatch(/^REDIS_PASSWORD=/m);
  });
});

/**
 * The production stack is a different file with the opposite defaults: nothing
 * is reachable from outside the host, because Nginx is the only thing the
 * internet talks to. These assertions are the ones that matter most — the
 * development file above is a laptop, this one is a server.
 */
describe('the production stack', () => {
  const PROD_PATH = join(__dirname, '..', '..', 'compose', 'docker-compose.prod.yml');
  const prod = readFileSync(PROD_PATH, 'utf8');

  function prodBlock(name: string): string {
    const lines = prod.split('\n');
    const start = lines.findIndex((line) => line === `  ${name}:`);
    if (start === -1) throw new Error(`docker-compose.prod.yml has no service "${name}"`);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^ {2}\S/.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join('\n');
  }

  it('reads the real file, not an empty one', () => {
    expect(prod).toContain('services:');
    expect(prod).toContain('vintrax-api');
  });

  it.each(['postgres', 'redis'])('publishes no host port at all for %s', (name) => {
    // Stronger than loopback: on a server there is no reason for either to be
    // reachable from the host, and `docker compose exec` still works without it.
    expect(prodBlock(name)).not.toMatch(/^ {4}ports:/m);
  });

  it.each(['api', 'web', 'mobile'])('binds %s to loopback, for Nginx to reach', (name) => {
    const block = prodBlock(name);
    const mappings = [...block.matchAll(/- '([^']+)'/g)].map((match) => match[1]!);

    expect(mappings.length).toBeGreaterThan(0);
    for (const mapping of mappings) {
      expect(mapping).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('builds nothing — the server runs what the registry holds', () => {
    // A `build:` here would mean the artefact CI verified is not the artefact
    // that runs, and that a rollback needs a working toolchain on the server.
    expect(prod).not.toMatch(/^ {4}build:/m);
  });

  it('hard-codes no secret, and fails loudly when one is missing', () => {
    for (const secret of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'POSTGRES_PASSWORD']) {
      // `:?` makes compose refuse to start rather than substitute an empty
      // string, which is how a JWT secret silently becomes "".
      expect(prod).toContain(`\${${secret}:?`);
    }
  });

  it('pins an image version rather than defaulting to a moving tag', () => {
    // A `:-latest` default would mean `up -d` could quietly change versions.
    expect(prod).toContain('${VINTRAX_VERSION:?');
    expect(prod).not.toContain('VINTRAX_VERSION:-');
  });

  it('starts the API only after migrations have succeeded', () => {
    expect(prodBlock('api')).toMatch(/migrate:\n\s+condition: service_completed_successfully/);
  });

  it('migrates with deploy, never with dev', () => {
    expect(prodBlock('migrate')).toContain("'migrate', 'deploy'");

    // Comments are stripped first: the file explains at length why `migrate
    // dev` is not used here, and matching that prose would be the test reading
    // its own documentation back.
    const directives = prod
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

    expect(directives).not.toContain('migrate dev');
    expect(directives).not.toContain('migrate reset');
  });

  it('keeps uploads and the database on named volumes', () => {
    // The container filesystem is disposable; listing photos are not.
    expect(prodBlock('api')).toContain('uploads-data:/app/backend/uploads');
    expect(prodBlock('postgres')).toContain('postgres-data:/var/lib/postgresql/data');
  });
});

/**
 * The release workflow now ends by deploying to production without a person in
 * the loop, which moves a class of mistake from "someone notices while typing"
 * to "nobody sees it until the site is down". These assert the properties that
 * were reasoned about when it was written, so a later edit that quietly drops
 * one fails here rather than in production.
 *
 * Read as text and matched by directive, the same way the compose assertions
 * above work, and with comments stripped first for the same reason: the file
 * explains itself at length, and matching that prose would be the test reading
 * its own documentation back.
 */
describe('the release workflow', () => {
  const RELEASE_PATH = join(__dirname, '..', '..', '.github', 'workflows', 'release.yml');
  const release = readFileSync(RELEASE_PATH, 'utf8');

  /** The file without its commentary, so a match is a directive. */
  const directives = release
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('reads the real file, not an empty one', () => {
    expect(release).toContain('name: Release');
    expect(release.length).toBeGreaterThan(500);
  });

  it('deploys only after every image has been published', () => {
    // `needs: publish` is the whole matrix. Without it a half-published build
    // could reach the server: two images at the new tag and one at the old.
    expect(directives).toMatch(/deploy:\n(\s+.*\n)*?\s+needs: publish\b/);
  });

  it('deploys the tag that run published, never a moving one', () => {
    // The version comes from the publish job's output rather than being
    // recomputed, and is checked to be an immutable sha- tag before use.
    expect(directives).toContain('VERSION: ${{ needs.publish.outputs.version }}');
    expect(directives).toMatch(/VERSION =~ \^sha-\[0-9a-f\]\{7,40\}\$/);
  });

  it('runs the deploy script that was already on the server', () => {
    // Not a second deployment mechanism. The same script, at its own path,
    // which is what keeps the manual path and rollback working.
    expect(directives).toContain("./deploy.sh '$VERSION'");
    expect(directives).toContain("TARGET_PATH: ${{ vars.DEPLOY_PATH || '/opt/vintrax' }}");
  });

  it('serialises production deployments and never cancels one part-way', () => {
    // A run killed between `prisma migrate deploy` and `compose up` is the
    // worst state this server can be left in.
    expect(directives).toMatch(
      /concurrency:\n\s+group: vintrax-production-deploy\n\s+cancel-in-progress: false/,
    );
  });

  it('deploys from main only, so a tag cut anywhere cannot go live', () => {
    expect(directives).toContain("if: github.ref == 'refs/heads/main'");
  });

  it('verifies the host key rather than trusting whatever answers', () => {
    // Without this the runner hands a key with shell access to production to
    // the first machine that replies on that address.
    expect(directives).toContain('StrictHostKeyChecking yes');
    expect(directives).toContain('DEPLOY_SSH_KNOWN_HOSTS');
    expect(directives).not.toContain('StrictHostKeyChecking no');

    // Mentioning `ssh-keyscan` is fine and is how the failure message tells an
    // operator where the secret comes from. *Running* it here is the problem:
    // it would trust whatever answered, which is the attack the pinned key
    // exists to stop. So this looks for an invocation, not for the word.
    expect(directives).not.toMatch(/(^|[|&;(`$]\s*)ssh-keyscan\b/m);
  });

  it('runs no destructive command on the server', () => {
    // The deploy script keeps old images precisely so rollback works, and the
    // volumes hold the database.
    expect(directives).not.toContain('system prune');
    expect(directives).not.toContain('down -v');
  });

  it('never reverts on its own', () => {
    // The step summary prints the rollback commands, which is the point — a
    // person reads them. What must not happen is this workflow running one:
    // a failed deploy may have applied a migration, and starting the previous
    // image against the new schema is how a bad release becomes data loss.
    // deploy.sh refuses to do it automatically for that reason, and so does
    // this. Hence: rollback.sh may appear, but never after an `ssh`.
    for (const line of directives.split('\n')) {
      if (line.includes('rollback.sh')) expect(line).not.toMatch(/\bssh\b/);
    }
  });

  it('confirms afterwards what the server is actually running', () => {
    expect(directives).toContain('./deploy.sh --list');
  });
});
