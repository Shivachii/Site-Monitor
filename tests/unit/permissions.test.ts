import { describe, expect, it } from "vitest";
import {
  hasPermission,
  requirePermission,
  type OrganizationRole,
} from "@/lib/auth/permissions";

describe("role permissions", () => {
  it.each<[OrganizationRole, boolean]>([
    ["owner", true],
    ["admin", true],
    ["member", false],
    ["viewer", false],
  ])("allows monitor management for %s: %s", (role, expected) => {
    expect(hasPermission(role, "monitors:manage")).toBe(expected);
  });

  it.each<[OrganizationRole, boolean]>([
    ["owner", true],
    ["admin", false],
    ["member", false],
    ["viewer", false],
  ])("restricts member management for %s: %s", (role, expected) => {
    expect(hasPermission(role, "members:manage")).toBe(expected);
  });

  it("lets members acknowledge incidents but keeps viewers read-only", () => {
    expect(hasPermission("member", "incidents:acknowledge")).toBe(true);
    expect(hasPermission("viewer", "incidents:acknowledge")).toBe(false);
    expect(() => requirePermission("viewer", "incidents:acknowledge")).toThrow(
      "FORBIDDEN",
    );
  });
});
