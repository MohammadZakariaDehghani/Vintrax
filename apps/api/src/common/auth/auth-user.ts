import type { UserRole } from '@atlas/shared';

/** The authenticated principal attached to `request.user` by the JWT strategy. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
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
