import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type LoginResponse } from "./api";

const TOKEN_KEY = "zeila.session";
const PUSH_KEY = "zeila.push";

interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  token: string | null;
  user: AuthUser | null;
}

interface AuthContextValue extends AuthState {
  /** Returns a ticket when a second factor is needed. */
  signIn: (email: string, password: string) => Promise<{ ticket: string } | null>;
  verify: (ticket: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Authenticated request; a 401 signs the device out. */
  request: <T>(path: string, options?: { method?: "GET" | "POST" | "DELETE"; body?: unknown }) => Promise<T>;
  rememberPushToken: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", token: null, user: null });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      if (!stored) {
        if (!cancelled) setState({ status: "signedOut", token: null, user: null });
        return;
      }
      try {
        const me = await api<{ user: AuthUser }>("/api/mobile/me", { token: stored });
        if (!cancelled) setState({ status: "signedIn", token: stored, user: me.user });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
        // Offline: keep the stored session and let screens retry.
        if (!cancelled) setState(error instanceof ApiError && error.status === 0 ? { status: "signedIn", token: stored, user: null } : { status: "signedOut", token: null, user: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(async (response: { token: string; user: AuthUser }) => {
    await SecureStore.setItemAsync(TOKEN_KEY, response.token);
    setState({ status: "signedIn", token: response.token, user: response.user });
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const response = await api<LoginResponse>("/api/mobile/auth/login", { method: "POST", body: { email, password, deviceName: Device.deviceName ?? undefined } });
      if ("twoFactorRequired" in response) return { ticket: response.ticket };
      await finish(response);
      return null;
    },
    [finish],
  );

  const verify = useCallback(
    async (ticket: string, code: string) => {
      const response = await api<{ token: string; user: AuthUser }>("/api/mobile/auth/verify", { method: "POST", body: { ticket, code, deviceName: Device.deviceName ?? undefined } });
      await finish(response);
    },
    [finish],
  );

  const signOut = useCallback(async () => {
    const pushToken = await SecureStore.getItemAsync(PUSH_KEY).catch(() => null);
    if (state.token) await api("/api/mobile/auth/logout", { method: "POST", token: state.token, body: { pushToken: pushToken ?? undefined } }).catch(() => undefined);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(PUSH_KEY).catch(() => undefined);
    setState({ status: "signedOut", token: null, user: null });
  }, [state.token]);

  const request = useCallback(
    async <T,>(path: string, options: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}): Promise<T> => {
      try {
        return await api<T>(path, { ...options, token: state.token });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
          setState({ status: "signedOut", token: null, user: null });
        }
        throw error;
      }
    },
    [state.token],
  );

  const rememberPushToken = useCallback(async (token: string) => {
    await SecureStore.setItemAsync(PUSH_KEY, token).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ ...state, signIn, verify, signOut, request, rememberPushToken }), [state, signIn, verify, signOut, request, rememberPushToken]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
