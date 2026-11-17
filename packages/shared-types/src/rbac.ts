/**
 * Role-based access control shared by web, mobile and workers.
 *
 * Roles are hierarchical in practice (every SELLER is also a buyer, staff can
 * do everything a customer can), but permissions are listed explicitly per
 * role so a change to one role never silently widens another.
 */

export const USER_ROLES = ["BUYER", "SELLER", "MODERATOR", "SUPER_ADMIN"] as const;
export type UserRoleValue = (typeof USER_ROLES)[number];

export const PERMISSIONS = [
  // Buying
  "order:create",
  "order:view-own",
  "review:create",
  "dispute:open",
  // Selling
  "store:manage",
  "listing:manage",
  "order:fulfil",
  "payout:view-own",
  "kyc:submit",
  // Moderation
  "kyc:review",
  "listing:moderate",
  "review:moderate",
  "dispute:resolve",
  "user:suspend",
  "fraud:review",
  // Platform administration
  "role:assign",
  "platform:configure",
  "ledger:reconcile",
  "audit:view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const BUYER_PERMISSIONS = ["order:create", "order:view-own", "review:create", "dispute:open", "kyc:submit"] as const;

const SELLER_PERMISSIONS = [
  ...BUYER_PERMISSIONS,
  "store:manage",
  "listing:manage",
  "order:fulfil",
  "payout:view-own",
] as const;

const MODERATOR_PERMISSIONS = [
  ...BUYER_PERMISSIONS,
  "kyc:review",
  "listing:moderate",
  "review:moderate",
  "dispute:resolve",
  "user:suspend",
  "fraud:review",
  "audit:view",
] as const;

export const ROLE_PERMISSIONS: Readonly<Record<UserRoleValue, ReadonlySet<Permission>>> = {
  BUYER: new Set<Permission>(BUYER_PERMISSIONS),
  SELLER: new Set<Permission>(SELLER_PERMISSIONS),
  MODERATOR: new Set<Permission>(MODERATOR_PERMISSIONS),
  SUPER_ADMIN: new Set<Permission>(PERMISSIONS),
};

export function isUserRole(value: unknown): value is UserRoleValue {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function hasPermission(role: UserRoleValue, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function hasAnyRole(role: UserRoleValue, allowed: readonly UserRoleValue[]): boolean {
  return allowed.includes(role);
}

/** Roles that may enter the staff area (`/admin`). */
export const STAFF_ROLES: readonly UserRoleValue[] = ["MODERATOR", "SUPER_ADMIN"];

export function isStaff(role: UserRoleValue): boolean {
  return STAFF_ROLES.includes(role);
}
