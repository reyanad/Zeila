import { ScrollView, Text } from "react-native";
import { POWERED_BY } from "@marketplace/shared-types";
import { useAuth } from "@/auth";
import { openWeb } from "@/links";
import { SignInPrompt } from "@/sign-in-prompt";
import { Body, Button, Card, Loading, Title, usePalette } from "@/ui";
import { useMe } from "@/use-me";

export default function AccountScreen() {
  const palette = usePalette();
  const { status, user, signOut } = useAuth();
  const me = useMe();
  if (status === "loading") return <Loading />;
  if (status !== "signedIn") return <SignInPrompt reason="Sign in or create an account to buy, sell and message." />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Title>{me?.user.name ?? user?.name ?? "Your account"}</Title>
      <Body muted>{me?.user.email ?? user?.email ?? ""}</Body>
      {me?.store ? (
        <Card>
          <Text style={{ color: palette.text, fontWeight: "600" }}>{me.store.name}</Text>
          <Body muted>Store status: {me.store.status.toLowerCase().replace("_", " ")}</Body>
          <Button label="Open seller studio" variant="outline" onPress={() => void openWeb("/seller/studio")} />
        </Card>
      ) : (
        <Button label="Start selling" variant="outline" onPress={() => void openWeb("/seller/onboarding")} />
      )}
      <Button label="Resolution center" variant="outline" onPress={() => void openWeb("/disputes")} />
      <Button label="Notification settings" variant="outline" onPress={() => void openWeb("/notifications")} />
      <Button label="Security and two-factor" variant="outline" onPress={() => void openWeb("/account/security")} />
      <Button label="Sign out" variant="danger" onPress={() => void signOut()} />
      <Body muted style={{ textAlign: "center", fontSize: 12, marginTop: 8 }}>
        {POWERED_BY}
      </Body>
    </ScrollView>
  );
}
