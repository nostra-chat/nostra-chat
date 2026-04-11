/**
 * Local Nostr relay (strfry in Docker) for E2E tests.
 *
 * Usage:
 *   const relay = new LocalRelay();
 *   await relay.start();          // starts container, waits for health
 *   const url = relay.url;        // ws://localhost:7777
 *   await relay.injectInto(ctx);  // pre-populates browser context IndexedDB
 *   // ... run tests ...
 *   await relay.stop();           // removes container
 */

// @ts-nocheck
import {execSync} from 'child_process';
import type {BrowserContext} from 'playwright';

const CONTAINER_NAME = 'nostra-e2e-relay';
const HOST_PORT = 7777;
const IMAGE = 'pluja/strfry:latest';

const STRFRY_CONF = `
relay {
    bind = "0.0.0.0"
    port = ${HOST_PORT}
    nofiles = 100000
    info {
        name = "E2E Test Relay"
        description = "Local relay for Nostra.chat E2E tests"
    }
}
events {
    maxEventSize = 65536
    rejectEventsNewerThanSeconds = 900
    rejectEventsOlderThanSeconds = 94608000
    rejectEphemeralEventsOlderThanSeconds = 60
    ephemeralEventsLifetimeSeconds = 300
    maxNumTags = 2000
    maxTagValSize = 1024
}
`.trim();

function exec(cmd: string): string {
  return execSync(cmd, {encoding: 'utf-8', timeout: 30000}).trim();
}

export class LocalRelay {
  public readonly url = `ws://localhost:${HOST_PORT}`;
  private running = false;

  /** Start the strfry Docker container. Idempotent — skips if already running. */
  async start(): Promise<void> {
    // Check if already running
    try {
      const state = exec(`docker inspect -f '{{.State.Running}}' ${CONTAINER_NAME} 2>/dev/null`);
      if(state === 'true') {
        this.running = true;
        return;
      }
    } catch{ /* not running */ }

    // Remove any stopped container with same name
    try { exec(`docker rm -f ${CONTAINER_NAME} 2>/dev/null`); } catch{ /* ignore */ }

    // Clean data dir via a throwaway container (files are owned by root)
    try { exec('docker run --rm -v /tmp/strfry-e2e-data:/d alpine rm -rf /d/*'); } catch{ /* ignore */ }

    // Write config to temp file
    const confPath = '/tmp/strfry-e2e.conf';
    const fs = await import('fs');
    fs.writeFileSync(confPath, STRFRY_CONF);

    // Start container with --user so data files are owned by the host user.
    // This makes stop() cleanup reliable without needing root or a helper container.
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;
    exec([
      'docker run -d',
      `--name ${CONTAINER_NAME}`,
      `--user ${uid}:${gid}`,
      `-p ${HOST_PORT}:${HOST_PORT}`,
      `-v ${confPath}:/etc/strfry.conf:ro`,
      `--tmpfs /app/strfry-db:uid=${uid},gid=${gid}`,
      IMAGE
    ].join(' '));

    // Wait for TCP readiness (up to 10s)
    const deadline = Date.now() + 10000;
    while(Date.now() < deadline) {
      try {
        const net = await import('net');
        await new Promise<void>((resolve, reject) => {
          const c = net.createConnection(HOST_PORT, 'localhost');
          c.on('connect', () => { c.end(); resolve(); });
          c.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 1000);
        });
        this.running = true;
        return;
      } catch{
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error('LocalRelay: strfry failed to start within 10s');
  }

  /** Stop and remove the Docker container. */
  async stop(): Promise<void> {
    try { exec(`docker rm -f ${CONTAINER_NAME} 2>/dev/null`); } catch{ /* ignore */ }
    // With --tmpfs the data dir lives in RAM inside the container —
    // nothing on disk to clean up. Remove stale host-mounted dirs from
    // older runs if they exist.
    try { exec('rm -rf /tmp/strfry-e2e-data 2>/dev/null'); } catch{ /* ignore */ }
    this.running = false;
  }

  /**
   * Inject the local relay URL into a Playwright BrowserContext.
   * Sets window.__nostraTestRelays BEFORE any app code loads, which
   * nostr-relay-pool.ts reads at module init time to override DEFAULT_RELAYS.
   */
  async injectInto(ctx: BrowserContext): Promise<void> {
    const relayConfig = JSON.stringify([
      {url: this.url, read: true, write: true}
    ]);

    await ctx.addInitScript(`
      window.__nostraTestRelays = ${relayConfig};
    `);
  }

  /** Check if the relay is reachable. */
  async isHealthy(): Promise<boolean> {
    try {
      const net = await import('net');
      await new Promise<void>((resolve, reject) => {
        const c = net.createConnection(HOST_PORT, 'localhost');
        c.on('connect', () => { c.end(); resolve(); });
        c.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 2000);
      });
      return true;
    } catch {
      return false;
    }
  }
}
