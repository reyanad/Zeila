import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, useColorScheme, View, type TextInputProps, type ViewStyle } from "react-native";

export interface Palette {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
  success: string;
  accent: string;
}

const LIGHT: Palette = { bg: "#f9f9f7", card: "#ffffff", text: "#0b0b0b", muted: "#52514e", border: "#e1e0d9", primary: "#18181b", primaryText: "#ffffff", danger: "#d03b3b", success: "#006300", accent: "#2a78d6" };
const DARK: Palette = { bg: "#0d0d0d", card: "#1a1a19", text: "#f0efec", muted: "#c3c2b7", border: "#2c2c2a", primary: "#f0efec", primaryText: "#0b0b0b", danger: "#e66767", success: "#0ca30c", accent: "#3987e5" };

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? DARK : LIGHT;
}

export function Title({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return <Text style={[styles.title, { color: palette.text }]}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const palette = usePalette();
  return <Text style={[styles.body, { color: muted ? palette.muted : palette.text }, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const palette = usePalette();
  return <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }, style]}>{children}</View>;
}

export function Button({ label, onPress, variant = "primary", loading, disabled }: { label: string; onPress: () => void; variant?: "primary" | "outline" | "danger"; loading?: boolean; disabled?: boolean }) {
  const palette = usePalette();
  const background = variant === "primary" ? palette.primary : variant === "danger" ? palette.danger : "transparent";
  const color = variant === "outline" ? palette.text : variant === "danger" ? "#ffffff" : palette.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: background, borderColor: variant === "outline" ? palette.border : background, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
      <TextInput placeholderTextColor={palette.muted} {...input} style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.card }, input.style]} />
    </View>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "danger" | "info" }) {
  const palette = usePalette();
  const color = tone === "success" ? palette.success : tone === "danger" ? palette.danger : tone === "info" ? palette.accent : palette.muted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Notice({ text, tone = "danger" }: { text: string; tone?: "danger" | "info" }) {
  const palette = usePalette();
  return (
    <Text accessibilityRole="alert" style={[styles.body, { color: tone === "danger" ? palette.danger : palette.muted }]}>
      {text}
    </Text>
  );
}

export function Loading() {
  const palette = usePalette();
  return (
    <View style={[styles.center, { backgroundColor: palette.bg }]}>
      <ActivityIndicator color={palette.muted} />
    </View>
  );
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={[styles.center, { backgroundColor: palette.bg, gap: 16, padding: 24 }]}>
      <Text style={[styles.body, { color: palette.muted, textAlign: "center" }]}>{text}</Text>
      {action}
    </View>
  );
}

export const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 6 },
  button: { minHeight: 46, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  field: { gap: 6 },
  label: { fontSize: 13 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "500" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
