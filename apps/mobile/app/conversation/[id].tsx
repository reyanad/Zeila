import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { ApiError, type ConversationDetail } from "@/api";
import { useAuth } from "@/auth";
import { money, timeAgo } from "@/format";
import { openWeb } from "@/links";
import { SignInPrompt } from "@/sign-in-prompt";
import { Button, Card, Loading, Notice, styles, usePalette } from "@/ui";

const POLL_MS = 5_000;

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const { status, request } = useAuth();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<{ tone: "danger" | "info"; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList<ConversationDetail["messages"][number]>>(null);

  const load = useCallback(async () => {
    try {
      setConversation(await request<ConversationDetail>(`/api/mobile/conversations/${encodeURIComponent(id ?? "")}`));
    } catch (caught) {
      setNotice({ tone: "danger", text: caught instanceof ApiError ? caught.message : "Could not load the conversation." });
    }
  }, [id, request]);

  // Poll while the thread is on screen; push notifications cover the rest.
  useFocusEffect(
    useCallback(() => {
      if (status !== "signedIn") return;
      void load();
      const timer = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(timer);
    }, [status, load]),
  );

  if (status === "loading") return <Loading />;
  if (status !== "signedIn") return <SignInPrompt reason="Sign in to read your messages." />;
  if (!conversation) return notice ? <Notice text={notice.text} /> : <Loading />;

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const result = await request<{ ok: true; flagged: boolean }>(`/api/mobile/conversations/${conversation.id}`, { method: "POST", body: { body } });
      setBody("");
      setNotice(result.flagged ? { tone: "info", text: "Contact details were hidden. Keep payments here so escrow protects you both." } : null);
      await load();
    } catch (caught) {
      setNotice({ tone: "danger", text: caught instanceof ApiError ? caught.message : "Could not send." });
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: conversation.title }} />
      <FlatList
        ref={list}
        data={conversation.messages}
        keyExtractor={(message) => message.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<Text style={{ color: palette.muted, textAlign: "center", marginTop: 40 }}>Say hello and ask your question.</Text>}
        renderItem={({ item }) =>
          item.offer ? (
            <Card style={{ alignSelf: item.mine ? "flex-end" : "flex-start", maxWidth: "90%", borderColor: palette.accent }}>
              <Text style={{ color: palette.muted, fontSize: 12 }}>CUSTOM OFFER · {item.offer.status.toLowerCase()}</Text>
              <Text style={{ color: palette.text, fontWeight: "600" }}>{item.offer.title}</Text>
              <Text style={{ color: palette.muted }}>{item.offer.description}</Text>
              <Text style={{ color: palette.text }}>
                {money(item.offer.price, item.offer.currency)} · {item.offer.deliveryDays} days · {item.offer.revisions < 0 ? "unlimited" : item.offer.revisions} revisions
              </Text>
              {!item.mine && item.offer.status === "OPEN" ? <Button label="Review and pay" onPress={() => void openWeb(conversation.webUrl)} /> : null}
            </Card>
          ) : (
            <View style={{ alignSelf: item.mine ? "flex-end" : "flex-start", maxWidth: "85%", gap: 2 }}>
              <Text style={{ backgroundColor: item.mine ? palette.primary : palette.card, color: item.mine ? palette.primaryText : palette.text, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, overflow: "hidden" }}>{item.body}</Text>
              {item.flagged ? <Text style={{ color: palette.danger, fontSize: 11 }}>Mentions contact details or paying outside the platform.</Text> : null}
              <Text style={{ color: palette.muted, fontSize: 11, alignSelf: item.mine ? "flex-end" : "flex-start" }}>{timeAgo(item.createdAt)}</Text>
            </View>
          )
        }
      />
      <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.card }}>
        {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <TextInput
            accessibilityLabel="Message"
            placeholder="Write a message"
            placeholderTextColor={palette.muted}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={4000}
            style={[styles.input, { flex: 1, color: palette.text, borderColor: palette.border, backgroundColor: palette.bg, paddingTop: 12, maxHeight: 120 }]}
          />
          <View style={{ width: 84 }}>
            <Button label="Send" loading={sending} disabled={!body.trim()} onPress={() => void send()} />
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
