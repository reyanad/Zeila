import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { POWERED_BY } from "@marketplace/shared-types";
import { ApiError } from "@/api";
import { useAuth } from "@/auth";
import { openWeb } from "@/links";
import { Body, Button, Field, Notice, Title, usePalette } from "@/ui";

export default function LoginScreen() {
  const palette = usePalette();
  const { signIn, verify } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (ticket) {
        await verify(ticket, code.trim());
        done();
        return;
      }
      const result = await signIn(email.trim(), password);
      if (result) setTicket(result.ticket);
      else done();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not sign in.");
      if (caught instanceof ApiError && ticket && caught.status === 401 && caught.message.includes("timed out")) setTicket(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Title>{ticket ? "Two-step verification" : "Welcome back"}</Title>
        {ticket ? (
          <>
            <Body muted>Enter the 6-digit code from your authenticator app, or a recovery code.</Body>
            <Field label="Code" value={code} onChangeText={setCode} autoComplete="one-time-code" textContentType="oneTimeCode" keyboardType="number-pad" autoFocus />
          </>
        ) : (
          <>
            <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" />
          </>
        )}
        {error ? <Notice text={error} /> : null}
        <Button label={ticket ? "Verify" : "Sign in"} loading={busy} disabled={ticket ? code.trim().length < 6 : !email || !password} onPress={() => void submit()} />
        {!ticket ? (
          <>
            <Button label="Create an account" variant="outline" onPress={() => void openWeb("/register")} />
            <Button label="Forgot your password?" variant="outline" onPress={() => void openWeb("/forgot-password")} />
          </>
        ) : null}
        <Body muted style={{ textAlign: "center", fontSize: 12, marginTop: 8 }}>
          {POWERED_BY}
        </Body>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
