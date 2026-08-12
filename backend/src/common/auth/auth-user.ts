import { ROLE_PERMISSIONS, type Permission, type UserRole, type UserStatus } from '@atlas/shared';

/** The authenticated principal attached to `request.user` by the JWT strategy. */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  /** Set for DEALER accounts, so ownership checks avoid an extra query. */
  dealerId: string | null;
}

/** Shape of a signed access token payload. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

/** Shape of a signed refresh token payload. `jti` ties it to a stored record. */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export function permissionsFor(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isAdmin(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function displayNameOf(user: Pick<AuthUser, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
