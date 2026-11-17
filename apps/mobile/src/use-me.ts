import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import type { Me } from "./api";
import { useAuth } from "./auth";

/** Profile and unread counts, refreshed whenever a tab gains focus. */
export function useMe(): Me | null {
  const { status, request } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (status !== "signedIn") {
        setMe(null);
        return;
      }
      let cancelled = false;
      request<Me>("/api/mobile/me")
        .then((value) => {
          if (!cancelled) setMe(value);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [status, request]),
  );
  return me;
}
