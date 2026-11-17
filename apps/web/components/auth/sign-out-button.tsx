"use client";

import { signOut } from "next-auth/react";
import { Button, type ButtonProps } from "@marketplace/ui";

export function SignOutButton({ children = "Sign out", ...rest }: Omit<ButtonProps, "onClick" | "type">) {
  return (
    <Button variant="ghost" size="sm" {...rest} onClick={() => void signOut({ callbackUrl: "/" })}>
      {children}
    </Button>
  );
}
