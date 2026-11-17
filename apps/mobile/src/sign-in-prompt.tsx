import { router } from "expo-router";
import { Button, Empty } from "./ui";

export function SignInPrompt({ reason }: { reason: string }) {
  return <Empty text={reason} action={<Button label="Sign in" onPress={() => router.push("/login")} />} />;
}
