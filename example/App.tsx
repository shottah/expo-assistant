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

type Status =
  | { state: 'pending' }
  | { state: 'registered' }
  | { state: 'fired'; payload: { title: string; when: string } }
  | { state: 'donated'; payload: { title: string; when: string } }
  | { state: 'error'; message: string };

type EventRow = { title: string; when: string; at: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ state: 'pending' });
  const [events, setEvents] = useState<EventRow[]>([]);
  const assistantRef = useRef<VoiceAssistant | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const va = await VoiceAssistant.initialize({ debugMode: true });
        assistantRef.current = va;

        await va.registerIntent(
          VoiceIntentBuilder.create<{ title: string; when: string }>()
            .withId('create-event')
            .withCategory(IntentCategory.PRODUCTIVITY)
            .requiredParameter('title', { type: ParameterType.STRING })
            .requiredParameter('when', { type: ParameterType.STRING })
            .withHandler({
              handle: async ({ title, when }) => {
                const row: EventRow = {
                  title,
                  when,
                  at: new Date().toLocaleTimeString(),
                };
                setEvents((prev) => [row, ...prev].slice(0, 5));
                setStatus({ state: 'fired', payload: { title, when } });
                return { ok: true };
              },
            })
            .build()
        );

        setStatus({ state: 'registered' });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setStatus({ state: 'error', message });
      }
    })();
  }, []);

  const donateSample = () => {
    const sample = { title: 'team standup', when: 'tomorrow at 9am' };
    assistantRef.current
      ?.donateIntent('create-event', sample)
      .then(() => setStatus({ state: 'donated', payload: sample }))
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        setStatus({ state: 'error', message });
      });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.header}>expo-assistant example</Text>
        <Text style={styles.subheader}>
          Single-use-case multi-parameter demo
        </Text>

        <View style={styles.card} testID="card-create-event">
          <View style={styles.cardHead}>
            <Text style={styles.cardIcon}>📅</Text>
            <Text style={styles.cardTitle}>Create Event</Text>
            <StatusBadge status={status} />
          </View>

          <Text style={styles.cardSubtitle}>
            Two required parameters: <Text style={styles.code}>title</Text> and{' '}
            <Text style={styles.code}>when</Text>. iOS prompts for each in turn
            when you invoke the shortcut without bound values.
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Try in Shortcuts.app → Library:</Text>
            <Text style={styles.phrase}>"Create Event"</Text>
            <Text style={styles.helper}>
              Tap the tile → iOS asks "What's the event called?" → enter title →
              "When?" → enter when → handler fires.
            </Text>
          </View>

          {status.state === 'fired' || status.state === 'donated' ? (
            <View style={styles.payload}>
              <Text style={styles.payloadLabel}>
                {status.state === 'fired'
                  ? 'Last invocation:'
                  : 'Last donation:'}
              </Text>
              <Text style={styles.payloadLine}>
                title = "{status.payload.title}"
              </Text>
              <Text style={styles.payloadLine}>
                when = "{status.payload.when}"
              </Text>
            </View>
          ) : null}

          {status.state === 'error' ? (
            <View style={styles.payload}>
              <Text style={styles.errorLine}>Error: {status.message}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              title="Donate sample event"
              onPress={donateSample}
              testID="donate-create-event"
            />
          </View>

          <Text style={styles.footnote}>
            Voice slots like "Create event ${'${title}'} at ${'${when}'}" are
            NOT supported today — Apple's AppShortcutPhrase only accepts
            AppEntity / AppEnum types as slots. Free-form text is filled via
            the prompt path above (#37, unblocked once #28 lands).
          </Text>
        </View>

        {events.length > 0 ? (
          <View style={styles.card} testID="card-events">
            <Text style={styles.cardTitle}>Events captured this session</Text>
            {events.map((e, i) => (
              <View key={i} style={styles.eventRow}>
                <Text style={styles.eventTitle}>{e.title}</Text>
                <Text style={styles.eventWhen}>{e.when}</Text>
                <Text style={styles.eventAt}>{e.at}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const { label, style } = badgeFor(status);
  return (
    <Text style={[styles.badge, style]} testID="status">
      {label}
    </Text>
  );
}

function badgeFor(status: Status): {
  label: string;
  style: { backgroundColor: string; color: string };
} {
  switch (status.state) {
    case 'fired':
      return {
        label: 'fired',
        style: { backgroundColor: '#d1f5e0', color: '#1a7f3a' },
      };
    case 'donated':
      return {
        label: 'donated',
        style: { backgroundColor: '#dbeafe', color: '#1d4ed8' },
      };
    case 'registered':
      return {
        label: 'registered',
        style: { backgroundColor: '#f3f4f6', color: '#4b5563' },
      };
    case 'error':
      return {
        label: 'error',
        style: { backgroundColor: '#fee2e2', color: '#b91c1c' },
      };
    case 'pending':
    default:
      return {
        label: 'initializing…',
        style: { backgroundColor: '#f9fafb', color: '#6b7280' },
      };
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
  cardSubtitle: { fontSize: 13, color: '#374151' },
  code: { fontFamily: 'Menlo', fontSize: 12, color: '#7c3aed' },

  badge: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },

  section: { marginTop: 4 },
  sectionLabel: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase' },
  phrase: { fontSize: 14, color: '#111', fontStyle: 'italic', marginTop: 2 },
  helper: { fontSize: 11, color: '#6b7280', marginTop: 4 },

  payload: {
    backgroundColor: '#f9fafb',
    padding: 10,
    borderRadius: 8,
    marginTop: 4,
    gap: 2,
  },
  payloadLabel: {
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  payloadLine: { fontSize: 13, color: '#111', fontFamily: 'Menlo' },
  errorLine: { fontSize: 13, color: '#b91c1c', fontFamily: 'Menlo' },

  actions: { flexDirection: 'row', marginTop: 4 },

  footnote: {
    fontSize: 10,
    color: '#9ca3af',
    fontStyle: 'italic',
    marginTop: 8,
  },

  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  eventTitle: { flex: 1, fontSize: 14, color: '#111', fontWeight: '500' },
  eventWhen: { fontSize: 12, color: '#374151' },
  eventAt: { fontSize: 11, color: '#9ca3af' },
});
