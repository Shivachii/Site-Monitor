import { describe, expect, it } from "vitest";
import { monitorInputSchema } from "@/lib/validation/monitors";

describe("monitor input schema", () => {
  it("applies safe operational defaults", () => {
    const monitor = monitorInputSchema.parse({
      name: "Studio website",
      url: "https://shivachi.example/health",
    });

    expect(monitor).toMatchObject({
      intervalSeconds: 60,
      timeoutMs: 10_000,
      expectedStatusCodes: [200],
      failureThreshold: 3,
      recoveryThreshold: 1,
      latencyThresholdMs: null,
    });
  });

  it("rejects duplicate or invalid expected status codes", () => {
    const result = monitorInputSchema.safeParse({
      name: "Bad monitor",
      url: "https://example.com",
      expectedStatusCodes: [200, 200, 700],
    });

    expect(result.success).toBe(false);
  });

  it("rejects intervals shorter than one minute", () => {
    expect(
      monitorInputSchema.safeParse({
        name: "Too frequent",
        url: "https://example.com",
        intervalSeconds: 30,
      }).success,
    ).toBe(false);
  });
});
