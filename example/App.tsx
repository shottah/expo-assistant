import { useEffect, useMemo, useRef, useState } from 'react';
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
  type EntityRecord,
} from 'expo-assistant';

// Hardcoded set of projects the example pretends to own. A real app
// would source these from local storage / a server / etc. The resolver
// below filters this in-memory.
type Project = EntityRecord & { id: string; title: string; summary: string };

const PROJECTS: Project[] = [
  { id: 'atlas', title: 'Atlas', summary: 'API gateway revamp' },
  { id: 'beacon', title: 'Beacon', summary: 'Observability platform' },
  { id: 'cypress', title: 'Cypress', summary: 'Customer success workflows' },
  { id: 'delta', title: 'Delta', summary: 'Reporting + analytics' },
  { id: 'echo', title: 'Echo', summary: 'Voice + Siri integration' },
];

type Status =
  | { state: 'pending' }
  | { state: 'registered' }
  | { state: 'fired'; payload: Project }
  | { state: 'donated'; payload: Project }
  | { state: 'error'; message: string };

type LogRow = Project & { at: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ state: 'pending' });
  const [log, setLog] = useState<LogRow[]>([]);
  const assistantRef = useRef<VoiceAssistant | null>(null);

  // Stable count for the header.
  const projectCount = useMemo(() => PROJECTS.length, []);

  useEffect(() => {
    (async () => {
      try {
        const va = await VoiceAssistant.initialize({ debugMode: true });
        assistantRef.current = va;

        // Wire up the entity resolver BEFORE registering the intent so
        // any early scan-time queries from iOS have something to answer.
        // Three methods: matching (fuzzy text), resolve (by id), suggested.
        va.registerEntityResolver<Project>('Project', {
          matching: async (search) => {
            const q = search.toLowerCase().trim();
            if (!q) return PROJECTS.slice(0, 5);
            return PROJECTS.filter(
              (p) =>
                p.title.toLowerCase().includes(q) ||
                p.summary.toLowerCase().includes(q)
            );
          },
          resolve: async (ids) => PROJECTS.filter((p) => ids.includes(p.id)),
          suggested: async () => PROJECTS.slice(0, 3),
        });

        await va.registerIntent(
          VoiceIntentBuilder.create<{ project: Project }>()
            .withId('open-project')
            .withCategory(IntentCategory.PRODUCTIVITY)
            // Entity-typed parameters arrive as the full dict the JS
            // resolver returned, with at minimum { id, ...properties }.
            .requiredParameter('project', { type: ParameterType.OBJECT })
            .withHandler({
              handle: async ({ project }) => {
                const row: LogRow = {
                  ...project,
                  at: new Date().toLocaleTimeString(),
                };
                setLog((prev) => [row, ...prev].slice(0, 5));
                setStatus({ state: 'fired', payload: project });
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
    const sample = PROJECTS[0];
    assistantRef.current
      ?.donateIntent('open-project', { project: sample })
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
          AppEntity + EntityStringQuery — voice slot resolver demo
        </Text>

        <View style={styles.card} testID="card-open-project">
          <View style={styles.cardHead}>
            <Text style={styles.cardIcon}>📁</Text>
            <Text style={styles.cardTitle}>Open Project</Text>
            <StatusBadge status={status} />
          </View>

          <Text style={styles.cardSubtitle}>
            One entity-typed parameter: <Text style={styles.code}>project</Text>{' '}
            (AppEntity). When iOS scans Spotlight / extracts a voice phrase,
            it asks JS for matches via the registered resolver — same data
            powers the Library tap picker and Siri's autocomplete.
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Resolver inventory ({projectCount} projects):
            </Text>
            {PROJECTS.map((p) => (
              <Text key={p.id} style={styles.phrase}>
                <Text style={styles.code}>{p.id}</Text> — {p.title} ·{' '}
                {p.summary}
              </Text>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Library tap (simulator):</Text>
            <Text style={styles.phrase}>
              Shortcuts.app → Library → Open Project → autocomplete picker
            </Text>
            <Text style={styles.helper}>
              The picker fetches its options from this card's resolver via
              the entity bridge. Type "atl" → Atlas shows up.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Voice slot (not yet working in approach A):
            </Text>
            <Text style={styles.helper}>
              "Open <Text style={styles.code}>$&#123;project&#125;</Text> in
              MyApp" extraction at install time requires the entity values
              to be pre-indexed in Spotlight (linkd ingests phrases BEFORE
              any JS runs). The snapshot-store enhancement (#41) ships
              that path; today the Library tap flow exercises the same
              resolver end-to-end.
            </Text>
          </View>

          {status.state === 'fired' || status.state === 'donated' ? (
            <View style={styles.payload}>
              <Text style={styles.payloadLabel}>
                {status.state === 'fired'
                  ? 'Last invocation:'
                  : 'Last donation:'}
              </Text>
              <Text style={styles.payloadLine}>id = "{status.payload.id}"</Text>
              <Text style={styles.payloadLine}>
                title = "{status.payload.title}"
              </Text>
              <Text style={styles.payloadLine}>
                summary = "{status.payload.summary}"
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
              title="Donate Atlas sample"
              onPress={donateSample}
              testID="donate-open-project"
            />
          </View>
        </View>

        {log.length > 0 ? (
          <View style={styles.card} testID="card-log">
            <Text style={styles.cardTitle}>Projects opened this session</Text>
            {log.map((e, i) => (
              <View key={i} style={styles.logRow}>
                <Text style={styles.logTitle}>{e.title}</Text>
                <Text style={styles.logSummary}>{e.summary}</Text>
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
  phrase: { fontSize: 13, color: '#374151', marginTop: 2 },
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
  logTitle: { flex: 1, fontSize: 14, color: '#111', fontWeight: '500' },
  logSummary: { fontSize: 12, color: '#374151', flex: 2 },
  logAt: { fontSize: 11, color: '#9ca3af' },
});
