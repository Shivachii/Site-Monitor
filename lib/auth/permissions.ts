export const organizationRoles = [
  "owner",
  "admin",
  "member",
  "viewer",
] as const;

export type OrganizationRole = (typeof organizationRoles)[number];

export type Permission =
  | "organization:read"
  | "organization:manage"
  | "members:manage"
  | "monitors:read"
  | "monitors:manage"
  | "incidents:read"
  | "incidents:acknowledge"
  | "notifications:read"
  | "notifications:manage"
  | "notifications:test";

const rolePermissions: Record<OrganizationRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    "organization:read",
    "organization:manage",
    "members:manage",
    "monitors:read",
    "monitors:manage",
    "incidents:read",
    "incidents:acknowledge",
    "notifications:read",
    "notifications:manage",
    "notifications:test",
  ]),
  admin: new Set<Permission>([
    "organization:read",
    "monitors:read",
    "monitors:manage",
    "incidents:read",
    "incidents:acknowledge",
    "notifications:read",
    "notifications:manage",
    "notifications:test",
  ]),
  member: new Set<Permission>([
    "organization:read",
    "monitors:read",
    "incidents:read",
    "incidents:acknowledge",
    "notifications:read",
    "notifications:test",
  ]),
  viewer: new Set<Permission>([
    "organization:read",
    "monitors:read",
    "incidents:read",
    "notifications:read",
  ]),
};

export function hasPermission(role: OrganizationRole, permission: Permission) {
  return rolePermissions[role].has(permission);
}

export function requirePermission(
  role: OrganizationRole,
  permission: Permission,
): void {
  if (!hasPermission(role, permission)) {
    throw new Error("FORBIDDEN");
  }
}
