import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
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
  constructor(message) {
    super(message);
    this.name = "UnsafeMonitorUrlError";
  }
}

export function isPublicIpAddress(input) {
  if (!ipaddr.isValid(input)) return false;

  let address = ipaddr.parse(input);
  if (address.kind() === "ipv6" && address.isIPv4MappedAddress()) {
    address = address.toIPv4Address();
  }

  return !blockedIpRanges.has(address.range());
}

export function parseMonitorUrl(input) {
  let url;

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

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname.length > 253) {
    throw new UnsafeMonitorUrlError("The URL must contain a valid hostname.");
  }

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

async function validateTarget(input, lookup = dns.lookup) {
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

  const preferredAddress =
    addresses.find((address) => ipaddr.parse(address).kind() === "ipv4") ??
    addresses[0];

  return { url, address: preferredAddress };
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function requestOnce(target, timeoutMs) {
  const { url, address } = target;
  const transport = url.protocol === "https:" ? https : http;
  const parsedAddress = ipaddr.parse(address);
  const family = parsedAddress.kind() === "ipv6" ? 6 : 4;
  const originalHostname = url.hostname.replace(/^\[|\]$/g, "");

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: address,
        family,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          Host: url.host,
          "User-Agent": "Shivachi-Monitor/1.0",
        },
        servername: ipaddr.isValid(originalHostname)
          ? undefined
          : originalHostname,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        response.destroy();
        resolve({ statusCode, location });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms.`));
    });
    request.once("error", reject);
    request.end();
  });
}

export function isExpectedStatus(statusCode, expectedStatusCodes) {
  return expectedStatusCodes.includes(statusCode);
}

export async function checkHttpEndpoint({
  url,
  timeoutMs,
  expectedStatusCodes,
  maxRedirects = 5,
}) {
  const startedAt = new Date();
  const started = performance.now();
  let currentUrl = parseMonitorUrl(url);
  let redirectCount = 0;

  try {
    while (true) {
      const elapsedMs = performance.now() - started;
      const remainingTimeoutMs = Math.floor(timeoutMs - elapsedMs);
      if (remainingTimeoutMs <= 0) {
        throw new Error(`Request timed out after ${timeoutMs}ms.`);
      }

      const target = await withTimeout(
        validateTarget(currentUrl.href),
        remainingTimeoutMs,
        `Request timed out after ${timeoutMs}ms.`,
      );
      const requestTimeoutMs = Math.floor(
        timeoutMs - (performance.now() - started),
      );
      if (requestTimeoutMs <= 0) {
        throw new Error(`Request timed out after ${timeoutMs}ms.`);
      }

      const response = await requestOnce(target, requestTimeoutMs);

      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.location
      ) {
        if (redirectCount >= maxRedirects) {
          throw new Error(`Redirect limit of ${maxRedirects} exceeded.`);
        }

        currentUrl = parseMonitorUrl(
          new URL(response.location, currentUrl).href,
        );
        redirectCount += 1;
        continue;
      }

      const responseTimeMs = Math.max(
        0,
        Math.round(performance.now() - started),
      );
      const isSuccess = isExpectedStatus(
        response.statusCode,
        expectedStatusCodes,
      );

      return {
        checkedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        outcome: isSuccess ? "success" : "failure",
        httpStatusCode: response.statusCode || null,
        responseTimeMs,
        errorType: isSuccess ? null : "unexpected_status",
        errorMessage: isSuccess
          ? null
          : `Expected ${expectedStatusCodes.join(", ")}; received ${response.statusCode}.`,
        redirectCount,
      };
    }
  } catch (error) {
    return {
      checkedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      outcome: "failure",
      httpStatusCode: null,
      responseTimeMs: Math.max(0, Math.round(performance.now() - started)),
      errorType:
        error instanceof UnsafeMonitorUrlError
          ? "unsafe_target"
          : error && typeof error === "object" && "code" in error
            ? String(error.code).slice(0, 80)
            : "request_error",
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Unknown HTTP request failure.",
      redirectCount,
    };
  }
}
