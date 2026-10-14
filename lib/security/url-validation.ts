import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";

const blockedHostnames = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

const blockedHostnameSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
];

const blockedIpRanges = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal",
  "loopback",
  "private",
  "reserved",
  "carrierGradeNat",
  "benchmarking",
  "amt",
  "as112",
  "uniqueLocal",
  "ipv4Mapped",
  "rfc6145",
  "rfc6052",
  "6to4",
  "teredo",
]);

export class UnsafeMonitorUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeMonitorUrlError";
  }
}

export type ValidatedMonitorTarget = {
  url: URL;
  addresses: readonly string[];
};

export function isPublicIpAddress(input: string): boolean {
  if (!ipaddr.isValid(input)) return false;

  let address = ipaddr.parse(input);
  if (
    address.kind() === "ipv6" &&
    (address as ipaddr.IPv6).isIPv4MappedAddress()
  ) {
    address = (address as ipaddr.IPv6).toIPv4Address();
  }

  return !blockedIpRanges.has(address.range());
}

export function parseMonitorUrl(input: string): URL {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new UnsafeMonitorUrlError("The monitor URL is malformed.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeMonitorUrlError("Only HTTP and HTTPS URLs are supported.");
  }

  if (url.username || url.password) {
    throw new UnsafeMonitorUrlError(
      "Credentials embedded in URLs are not allowed.",
    );
  }

  if (!url.hostname || url.hostname.length > 253) {
    throw new UnsafeMonitorUrlError("The URL must contain a valid hostname.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    blockedHostnames.has(hostname) ||
    blockedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new UnsafeMonitorUrlError(
      "Local and internal hostnames are not allowed.",
    );
  }

  return url;
}

export async function validateMonitorTarget(
  input: string,
  lookup: typeof dns.lookup = dns.lookup,
): Promise<ValidatedMonitorTarget> {
  const url = parseMonitorUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  const addresses = ipaddr.isValid(hostname)
    ? [hostname]
    : (
        await lookup(hostname, {
          all: true,
          verbatim: true,
        })
      ).map((record) => record.address);

  if (addresses.length === 0) {
    throw new UnsafeMonitorUrlError(
      "The hostname did not resolve to an address.",
    );
  }

  if (addresses.some((address) => !isPublicIpAddress(address))) {
    throw new UnsafeMonitorUrlError(
      "The hostname resolves to a private, reserved, or unsafe address.",
    );
  }

  return { url, addresses: [...new Set(addresses)] };
}
