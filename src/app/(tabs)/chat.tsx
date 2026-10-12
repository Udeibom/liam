import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { showAlert } from '@/lib/toast';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants';

type Mode = 'general' | 'detective' | 'routine';

const MODE_STARTERS: Record<Mode, string> = {
  general: '',
  detective:
    "I want to investigate what&apos;s irritating my skin. Can you help me figure out what&apos;s going on?",
  routine: "I&apos;d like to build or improve my skincare routine.",
};

const SUGGESTIONS = [
  'Why am I still breaking out?',
  'Are my dark spots improving?',
  'Can I use these two products together?',
  'Is my routine working?',
  'What should I stop using?',
  'Something is irritating my skin',
];

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

type SkinCtx = Record<string, unknown> | null;

export default function ChatScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = (params.mode ?? 'general') as Mode;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [skinContext, setSkinContext] = useState<SkinCtx>(null);
  const [ready, setReady] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  // Defined before useEffect so it can be called inside loadContext
  const dispatchMessage = useCallback(
    async (
      text: string,
      convId: string,
      ctx: SkinCtx,
      existingMessages: Message[],
    ) => {
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: text.trim(),
      };
      const updated = [...existingMessages, userMsg];
      setMessages(updated);
      setLoading(true);

      try {
        const user = await getCurrentUser();
        if (!user) throw new Error('Not authenticated');

        await supabase.from('chat_messages').insert({
          conversation_id: convId,
          user_id: user.id,
          role: 'user',
          content: text.trim(),
        });

        const historyMsgs = updated.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const { data: fnData, error: fnError } = await supabase.functions.invoke('groq-chat', {
          body: { messages: historyMsgs, skinContext: ctx },
        });

        if (fnError) throw fnError;

        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: fnData.reply,
        };

        setMessages((prev) => [...prev, assistantMsg]);

        await supabase.from('chat_messages').insert({
          conversation_id: convId,
          user_id: user.id,
          role: 'assistant',
          content: fnData.reply,
        });
      } catch {
        showAlert('Error', 'Could not get a response. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const loadContext = async () => {
      const user = await getCurrentUser();
      if (!user) return;

      const [profileRes, scansRes, productsRes, routineRes] = await Promise.all([
        supabase.from('skin_profiles').select('*').eq('user_id', user.id).single(),
        supabase
          .from('skin_scans')
          .select('*')
          .eq('user_id', user.id)
          .order('scanned_at', { ascending: false })
          .limit(3),
        supabase.from('products').select('*').eq('user_id', user.id).eq('status', 'active'),
        supabase.from('routines').select('*').eq('user_id', user.id).single(),
      ]);

      const ctx: SkinCtx = {
        profile: profileRes.data,
        recentScans: scansRes.data ?? [],
        activeProducts: productsRes.data ?? [],
        routine: routineRes.data ?? null,
      };
      setSkinContext(ctx);

      const { data: convo } = await supabase
        .from('conversations')
        .insert({ user_id: user.id, type: mode })
        .select()
        .single();

      if (convo) {
        setConversationId(convo.id);
        setReady(true);

        const starter = MODE_STARTERS[mode];
        if (starter) {
          await dispatchMessage(starter, convo.id, ctx, []);
        }
      }
    };

    loadContext();
  }, [mode, dispatchMessage]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || !conversationId || !ready) return;
    setInput('');
    await dispatchMessage(text, conversationId, skinContext, messages);
  };

  const handleSend = () => sendMessage(input);

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.aiBubble]}>
      {item.role === 'assistant' && <Text style={styles.aiLabel}>LIAN</Text>}
      <Text style={[styles.bubbleText, item.role === 'user' ? styles.userText : styles.aiText]}>
        {item.content}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Ask LIAN</Text>
          {mode !== 'general' && (
            <View style={styles.modeBadge}>
              <Text style={styles.modeBadgeText}>
                {mode === 'detective' ? '🕵️ Detective' : '📋 Routine builder'}
              </Text>
            </View>
          )}
        </View>

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>What&apos;s going on with your skin?</Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={styles.suggestion}
                    onPress={() => sendMessage(s)}
                    accessibilityRole="button"
                    accessibilityLabel={s}
                  >
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
          ListFooterComponent={
            loading ? (
              <View style={[styles.bubble, styles.aiBubble]}>
                <Text style={styles.aiLabel}>LIAN</Text>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : null
          }
        />

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything about your skin…"
            placeholderTextColor={Colors.textTertiary}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            accessibilityLabel="Message input"
            accessibilityHint="Type a question about your skin"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || loading}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  modeBadge: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeBadgeText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: FontWeight.medium },
  messageList: {
    padding: Spacing.lg,
    gap: Spacing.md,
    flexGrow: 1,
  },
  empty: { gap: Spacing.lg },
  emptyText: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semiBold,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  suggestion: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestionText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  bubble: {
    maxWidth: '85%',
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.bgCard,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  aiLabel: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: FontWeight.semiBold },
  bubbleText: { fontSize: FontSize.base, lineHeight: 22 },
  userText: { color: Colors.textInverse },
  aiText: { color: Colors.textPrimary },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
    backgroundColor: Colors.bgCard,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.bgInput,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { fontSize: 20, color: Colors.textInverse, fontWeight: FontWeight.bold },
});
