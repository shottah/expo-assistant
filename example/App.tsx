import { useEffect, useRef, useState } from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  IntentCategory,
  ParameterType,
  VoiceAssistant,
  VoiceIntentBuilder,
} from 'expo-assistant';

import { parseEventQuery } from './lib/parseEventQuery';

type ShortcutStatus = {
  state: 'idle' | 'registered' | 'fired' | 'donated' | 'error';
  detail?: string;
};

const idleStatus: ShortcutStatus = { state: 'idle' };

export default function App() {
  const [boot, setBoot] = useState<'pending' | 'ready' | 'error'>('pending');
  const [bootError, setBootError] = useState<string | null>(null);
  const [search, setSearch] = useState<ShortcutStatus>(idleStatus);
  const [createEvent, setCreateEvent] = useState<ShortcutStatus>(idleStatus);
  const [quickNote, setQuickNote] = useState<ShortcutStatus>(idleStatus);
  const [notes, setNotes] = useState<string[]>([]);

  const assistantRef = useRef<VoiceAssistant | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const va = await VoiceAssistant.initialize({ debugMode: true });
        assistantRef.current = va;

        // ── Shortcut 1: Search ────────────────────────────────────────
        // The sweet-spot pattern for the current package: a single
        // free-form string, immediate user-provided value.
        await va.registerIntent(
          VoiceIntentBuilder.create<{ query: string }>()
            .withId('search')
            .withCategory(IntentCategory.SEARCH)
            .requiredParameter('query', { type: ParameterType.STRING })
            .withHandler({
              handle: async ({ query }) => {
                setSearch({ state: 'fired', detail: query });
                return { ok: true };
              },
            })
            .build()
        );

        // ── Shortcut 2: Create Event (NL-parsing demo) ────────────────
        // Phase 1: single string, JS-side parser splits the spoken
        // sentence into { title, date } heuristically. This is the
        // current package's ceiling — one string per invocation, app
        // handles structure.
        //
        // Phase 2 (after #25 multi-param): replace the parser with
        // distinct title/date AppShortcut parameters that Siri
        // extracts directly from the phrase template.
        // Phase 3 (after #29 rich types): the date parameter becomes
        // a native Date; Siri's NL date parser handles "tomorrow at
        // 9am" etc. without our help.
        // Phase 4 (after #28 AppEntity): add a calendar entity slot
        // with autocompletion against the user's calendars.
        await va.registerIntent(
          VoiceIntentBuilder.create<{ query: string }>()
            .withId('create-event')
            .withCategory(IntentCategory.PRODUCTIVITY)
            .requiredParameter('query', { type: ParameterType.STRING })
            .withHandler({
              handle: async ({ query }) => {
                const parsed = parseEventQuery(query);
                setCreateEvent({
                  state: 'fired',
                  detail: `title="${parsed.title}" · when=${parsed.when ?? '(unspecified)'}`,
                });
                return { ok: true, parsed };
              },
            })
            .build()
        );

        // ── Shortcut 3: Quick Note (append-style capture) ─────────────
        // Append pattern — the spoken string IS the payload, no
        // parsing needed. The handler stores it in app state to show
        // that a real app would persist what voice captures.
        await va.registerIntent(
          VoiceIntentBuilder.create<{ query: string }>()
            .withId('quick-note')
            .withCategory(IntentCategory.PRODUCTIVITY)
            .requiredParameter('query', { type: ParameterType.STRING })
            .withHandler({
              handle: async ({ query }) => {
                setNotes((prev) => [query, ...prev].slice(0, 5));
                setQuickNote({ state: 'fired', detail: query });
                return { ok: true };
              },
            })
            .build()
        );

        setSearch({ state: 'registered' });
        setCreateEvent({ state: 'registered' });
        setQuickNote({ state: 'registered' });
        setBoot('ready');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setBootError(msg);
        setBoot('error');
      }
    })();
  }, []);

  const donate = (id: string, params: Record<string, unknown>, setter: (s: ShortcutStatus) => void) => {
    assistantRef.current
      ?.donateIntent(id, params)
      .then(() => setter({ state: 'donated', detail: JSON.stringify(params) }))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setter({ state: 'error', detail: msg });
      });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.header}>expo-assistant example</Text>
        <Text style={styles.subheader}>
          {boot === 'pending' && 'initializing…'}
          {boot === 'ready' && '3 shortcuts registered'}
          {boot === 'error' && `boot error: ${bootError}`}
        </Text>

        <ShortcutCard
          id="search"
          title="Search"
          icon="🔍"
          status={search}
          phrases={[
            'Search in expo-assistant-example',
            'Search expo-assistant-example',
          ]}
          onDonate={() => donate('search', { query: 'tacos' }, setSearch)}
          donateLabel="Donate sample search"
        />

        <ShortcutCard
          id="create-event"
          title="Create Event"
          icon="📅"
          status={createEvent}
          phrases={[
            'Create event in expo-assistant-example',
            'Use expo-assistant-example to create an event',
          ]}
          onDonate={() =>
            donate('create-event', { query: 'team standup tomorrow at 9am' }, setCreateEvent)
          }
          donateLabel="Donate sample event"
          footer={
            <Text style={styles.helper}>
              Phase 1 (today): user is prompted for one query string at tap
              time, JS parses it heuristically into title + when. Phase 2
              (#25) splits them into typed AppShortcut parameters Siri
              extracts directly from the phrase. Phase 3 (#29) makes date
              native (Siri parses "tomorrow at 9am"). Phase 4 (#28) adds
              calendar entity with autocomplete.
            </Text>
          }
        />

        <ShortcutCard
          id="quick-note"
          title="Quick Note"
          icon="📝"
          status={quickNote}
          phrases={[
            'Add note to expo-assistant-example',
            'Quick note in expo-assistant-example',
          ]}
          onDonate={() =>
            donate(
              'quick-note',
              { query: 'remember to buy milk' },
              setQuickNote
            )
          }
          donateLabel="Donate sample note"
          footer={
            notes.length > 0 ? (
              <View style={styles.notes}>
                <Text style={styles.notesTitle}>Last {notes.length} note(s):</Text>
                {notes.map((n, i) => (
                  <Text key={i} style={styles.note}>
                    • {n}
                  </Text>
                ))}
              </View>
            ) : null
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function ShortcutCard({
  id,
  title,
  icon,
  status,
  phrases,
  onDonate,
  donateLabel,
  footer,
}: {
  id: string;
  title: string;
  icon: string;
  status: ShortcutStatus;
  phrases: string[];
  onDonate: () => void;
  donateLabel: string;
  footer?: React.ReactNode;
}) {
  return (
    <View style={styles.card} testID={`card-${id}`}>
      <View style={styles.cardHead}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={[styles.badge, badgeStyle(status.state)]} testID={`status-${id}`}>
          {status.state}
        </Text>
      </View>

      {status.detail ? (
        <Text style={styles.detail} testID={`detail-${id}`}>
          {status.detail}
        </Text>
      ) : null}

      <Text style={styles.phrasesLabel}>Try saying / typing in Shortcuts:</Text>
      {phrases.map((p, i) => (
        <Text key={i} style={styles.phrase}>
          "{p}"
        </Text>
      ))}

      {footer}

      <View style={styles.actions}>
        <Button title={donateLabel} onPress={onDonate} testID={`donate-${id}`} />
      </View>
    </View>
  );
}

function badgeStyle(state: ShortcutStatus['state']) {
  switch (state) {
    case 'fired':
      return { backgroundColor: '#d1f5e0', color: '#1a7f3a' };
    case 'donated':
      return { backgroundColor: '#dbeafe', color: '#1d4ed8' };
    case 'registered':
      return { backgroundColor: '#f3f4f6', color: '#4b5563' };
    case 'error':
      return { backgroundColor: '#fee2e2', color: '#b91c1c' };
    default:
      return { backgroundColor: '#f9fafb', color: '#6b7280' };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scroll: { padding: 16, gap: 12, paddingBottom: 48 },
  header: { fontSize: 24, fontWeight: '700', color: '#111' },
  subheader: { fontSize: 13, color: '#6b7280', marginBottom: 8 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardIcon: { fontSize: 20 },
  cardTitle: { fontSize: 17, fontWeight: '600', flex: 1, color: '#111' },
  badge: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  detail: {
    fontSize: 13,
    color: '#111',
    backgroundColor: '#f9fafb',
    padding: 8,
    borderRadius: 6,
    fontFamily: 'Menlo',
  },
  phrasesLabel: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  phrase: { fontSize: 13, color: '#374151', fontStyle: 'italic' },
  helper: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  notes: { marginTop: 4, gap: 2 },
  notesTitle: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase' },
  note: { fontSize: 13, color: '#111' },
  actions: { flexDirection: 'row', marginTop: 4 },
});
