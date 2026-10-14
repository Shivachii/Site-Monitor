import { describe, expect, it } from "vitest";
import {
  isExpectedStatus,
  isPublicIpAddress,
  parseMonitorUrl,
  UnsafeMonitorUrlError,
} from "../../worker/http-check.mjs";

describe("standalone worker HTTP checks", () => {
  it.each([
    "http://localhost",
    "https://service.internal/health",
    "ftp://example.com/file",
    "https://user:password@example.com",
  ])("rejects unsafe target %s", (url) => {
    expect(() => parseMonitorUrl(url)).toThrow(UnsafeMonitorUrlError);
  });

  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1"])(
    "rejects non-public address %s",
    (address) => {
      expect(isPublicIpAddress(address)).toBe(false);
    },
  );

  it("matches only configured HTTP status codes", () => {
    expect(isExpectedStatus(200, [200, 204])).toBe(true);
    expect(isExpectedStatus(503, [200, 204])).toBe(false);
  });
});
