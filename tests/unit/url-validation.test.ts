import dns from "node:dns/promises";
import { describe, expect, it } from "vitest";
import {
  isPublicIpAddress,
  parseMonitorUrl,
  UnsafeMonitorUrlError,
  validateMonitorTarget,
} from "@/lib/security/url-validation";

describe("monitor URL validation", () => {
  it.each([
    "http://localhost",
    "https://api.internal/health",
    "https://router.local",
    "ftp://example.com/file",
    "https://user:secret@example.com",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => parseMonitorUrl(url)).toThrow(UnsafeMonitorUrlError);
  });

  it("accepts a normal HTTPS target before DNS validation", () => {
    expect(parseMonitorUrl("https://example.com/health").href).toBe(
      "https://example.com/health",
    );
  });

  it.each([
    "127.0.0.1",
    "10.0.0.4",
    "172.16.10.2",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("rejects non-public IP address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "accepts public IP address %s",
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true);
    },
  );

  it("rejects a hostname when any DNS answer is unsafe", async () => {
    const lookup = (async () => [
      { address: "203.0.113.10", family: 4 as const },
      { address: "127.0.0.1", family: 4 as const },
    ]) as unknown as typeof dns.lookup;

    await expect(
      validateMonitorTarget("https://example.com", lookup),
    ).rejects.toThrow("private, reserved, or unsafe");
  });

  it("returns every validated public DNS answer for connection pinning", async () => {
    const lookup = (async () => [
      { address: "1.1.1.1", family: 4 as const },
      { address: "2606:4700:4700::1111", family: 6 as const },
    ]) as unknown as typeof dns.lookup;

    await expect(
      validateMonitorTarget("https://example.com", lookup),
    ).resolves.toMatchObject({
      addresses: ["1.1.1.1", "2606:4700:4700::1111"],
    });
  });
});
