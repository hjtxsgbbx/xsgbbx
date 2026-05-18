import type * as tls from "tls";
import * as crypto from "crypto";

const KNOWN_FINGERPRINTS: Record<string, string[]> = {
  "api.anthropic.com": [
    "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  ],
  "api.openai.com": [
    "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  ],
};

let pinningEnabled = true;
let pinningErrorCallback: ((err: Error, host: string) => void) | null = null;

export function setPinningEnabled(enabled: boolean): void {
  pinningEnabled = enabled;
}

export function setPinningErrorCallback(cb: (err: Error, host: string) => void): void {
  pinningErrorCallback = cb;
}

export function createPinnedAgent(host: string): tls.ConnectionOptions | undefined {
  if (!pinningEnabled) return undefined;

  const fingerprints = KNOWN_FINGERPRINTS[host];
  if (!fingerprints) return undefined;

  return {
    checkServerIdentity: (servername: string, cert: tls.PeerCertificate): Error | undefined => {
      const raw = cert.raw;
      if (!raw || raw.length === 0) {
        const err = new Error(`Certificate pinning failed for ${host}: empty certificate`);
        pinningErrorCallback?.(err, host);
        return err;
      }

      const hash = crypto.createHash("sha256").update(raw).digest("base64");
      const fingerprint = `sha256/${hash}`;

      if (fingerprints.includes(fingerprint)) {
        return undefined;
      }

      const err = new Error(
        `Certificate pinning failed for ${host}: unknown fingerprint ${fingerprint}. ` +
        `Expected one of: ${fingerprints.join(", ")}`
      );
      pinningErrorCallback?.(err, host);
      return err;
    },
  };
}

export function verifyHostname(host: string): boolean {
  const allowedHosts = Object.keys(KNOWN_FINGERPRINTS);
  return allowedHosts.includes(host) || !pinningEnabled;
}

export function getPinnedHosts(): string[] {
  return Object.keys(KNOWN_FINGERPRINTS);
}