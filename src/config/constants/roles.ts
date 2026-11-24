// src/config/constants/roles.ts

export const PROFILE_ROLES = ["customer", "admin", "super_admin", "dev"] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

export const ADMIN_ROLES = ["admin", "super_admin", "dev"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

// Typed includes helper (fixes TS2345 + gives type guards)
function includesConst<T extends readonly string[]>(
  arr: T,
  value: string,
): value is T[number] {
  return (arr as readonly string[]).includes(value);
}

export function isProfileRole(value: unknown): value is ProfileRole {
  return typeof value === "string" && includesConst(PROFILE_ROLES, value);
}

export function isAdminRole(role: ProfileRole): role is AdminRole {
  return includesConst(ADMIN_ROLES, role);
}
