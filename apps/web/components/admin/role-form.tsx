"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { USER_ROLES } from "@marketplace/shared-types";
import { Button, Select } from "@marketplace/ui";
import { setUserRoleAction } from "@/lib/actions/admin";

export function RoleForm({ userId, current }: { userId: string; current: string }) {
  const router = useRouter();
  const [role, setRole] = useState(current);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Select aria-label="Role" value={role} onChange={(event) => setRole(event.currentTarget.value)} className="w-48">
          {USER_ROLES.map((value) => (
            <option key={value} value={value}>
              {value.toLowerCase().replace("_", " ")}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || role === current}
          onClick={() =>
            startTransition(async () => {
              const result = await setUserRoleAction(userId, role);
              setMessage({ ok: result.ok, text: result.message ?? "" });
              if (result.ok) router.refresh();
            })
          }
        >
          Change role
        </Button>
      </div>
      {message?.text ? <p className={message.ok ? "text-xs" : "text-xs font-medium text-destructive"}>{message.text}</p> : null}
    </div>
  );
}
