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

type WorkoutKind = 'running' | 'cycling' | 'swimming' | 'yoga';
type Duration = { value: number; unit: string };
type WorkoutPayload = { kind: WorkoutKind; duration: Duration };

type Status =
  | { state: 'pending' }
  | { state: 'registered' }
  | { state: 'fired'; payload: WorkoutPayload }
  | { state: 'donated'; payload: WorkoutPayload }
  | { state: 'error'; message: string };

type LogRow = WorkoutPayload & { at: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ state: 'pending' });
  const [log, setLog] = useState<LogRow[]>([]);
  const assistantRef = useRef<VoiceAssistant | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const va = await VoiceAssistant.initialize({ debugMode: true });
        assistantRef.current = va;

        await va.registerIntent(
          VoiceIntentBuilder.create<WorkoutPayload>()
            .withId('start-workout')
            .withCategory(IntentCategory.HEALTH)
            // `kind` arrives as the enum case's `id` string ('running' etc.)
            // because Swift marshals AppEnum via .rawValue.
            .requiredParameter('kind', { type: ParameterType.STRING })
            // `duration` arrives as { value: Double, unit: String } — Swift
            // marshals Measurement as a dict (unit is the symbol e.g. "min").
            .requiredParameter('duration', { type: ParameterType.OBJECT })
            .withHandler({
              handle: async ({ kind, duration }) => {
                const row: LogRow = {
                  kind,
                  duration,
                  at: new Date().toLocaleTimeString(),
                };
                setLog((prev) => [row, ...prev].slice(0, 5));
                setStatus({ state: 'fired', payload: { kind, duration } });
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
    const sample: WorkoutPayload = {
      kind: 'cycling',
      duration: { value: 30, unit: 'min' },
    };
    assistantRef.current
      ?.donateIntent('start-workout', sample)
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
          AppEnum + rich primitive type demo
        </Text>

        <View style={styles.card} testID="card-start-workout">
          <View style={styles.cardHead}>
            <Text style={styles.cardIcon}>🏃</Text>
            <Text style={styles.cardTitle}>Start Workout</Text>
            <StatusBadge status={status} />
          </View>

          <Text style={styles.cardSubtitle}>
            Two parameters, two type families:{' '}
            <Text style={styles.code}>kind</Text> is an AppEnum (so it can
            appear in voice phrase slots),{' '}
            <Text style={styles.code}>duration</Text> is a Measurement
            (Swift) → <Text style={styles.code}>{`{ value, unit }`}</Text>{' '}
            (JS).
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Voice (real device only):</Text>
            <Text style={styles.phrase}>
              "Start cycling workout in expo-assistant-example"
            </Text>
            <Text style={styles.helper}>
              Siri extracts <Text style={styles.code}>kind=cycling</Text>{' '}
              from the phrase, then prompts for duration.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Library tap (simulator):</Text>
            <Text style={styles.phrase}>
              Shortcuts.app → Library → Start Workout
            </Text>
            <Text style={styles.helper}>
              iOS prompts: "Which workout?" with a picker showing each
              WorkoutType case → "How long?" with a duration input → handler
              fires.
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
                kind = "{status.payload.kind}"
              </Text>
              <Text style={styles.payloadLine}>
                duration = {status.payload.duration.value}{' '}
                {status.payload.duration.unit}
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
              title="Donate 30-minute cycling sample"
              onPress={donateSample}
              testID="donate-start-workout"
            />
          </View>
        </View>

        {log.length > 0 ? (
          <View style={styles.card} testID="card-log">
            <Text style={styles.cardTitle}>Workouts captured this session</Text>
            {log.map((e, i) => (
              <View key={i} style={styles.logRow}>
                <Text style={styles.logKind}>{e.kind}</Text>
                <Text style={styles.logDuration}>
                  {e.duration.value} {e.duration.unit}
                </Text>
                <Text style={styles.logAt}>{e.at}</Text>
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

  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  logKind: { flex: 1, fontSize: 14, color: '#111', fontWeight: '500' },
  logDuration: { fontSize: 12, color: '#374151' },
  logAt: { fontSize: 11, color: '#9ca3af' },
});
