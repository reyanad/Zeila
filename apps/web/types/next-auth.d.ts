import type { DefaultSession } from "next-auth";
import type { UserRoleValue } from "@marketplace/shared-types";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: UserRoleValue;
    };
    /** User.sessionVersion the session was issued under (checked server-side on every request). */
    sessionVersion: number;
  }

  interface User {
    role?: UserRoleValue;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** User id (also in `sub`). */
    uid?: string;
    role?: UserRoleValue;
    /** User.sessionVersion at the time the token was issued. */
    sv?: number;
  }
}
