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

        // Vanilla AppIntent — voice-triggerable via the declared phrase
        // template. This is the path Siri actually uses for direct voice
        // commands like "Hey Siri, search expo-assistant-example".
        // The string `query` parameter cannot be a voice slot (DTS ruling
        // #37), so iOS prompts via requestValueDialog after matching the
        // bare phrase.
        await va.registerIntent(
          VoiceIntentBuilder.create<{ query: string }>()
            .withId('search-voice')
            .withCategory(IntentCategory.SEARCH)
            .requiredParameter('query', { type: ParameterType.STRING })
            .withHandler({
              handle: async ({ query }) => {
                console.log(
                  `[expo-assistant-30] search-voice invoked (vanilla path), query="${query}"`
                );
                return { ok: true, query };
              },
            })
            .build()
        );

        // Schema-bound intent for the #30 first cut. The plugin generates
        // a @AppIntent(schema: .system.search) Swift struct; perform()
        // routes here with the criteria string unwrapped from
        // StringSearchCriteria.term by the codegen.
        //
        // Empirical finding (2026-05-22, iPhone 16 Pro + iOS 26.2 + AI on):
        // schema intents do NOT route via Siri voice phrase matching.
        // Library tap works; voice falls through to web search. Use the
        // schema-bound intent for AI-surfaced contexts (Spotlight tiles,
        // onscreen-content suggestions); use the vanilla `search-voice`
        // intent above for Siri voice triggering.
        await va.registerIntent(
          VoiceIntentBuilder.create<{ criteria: string }>()
            .withId('search-products')
            .withCategory(IntentCategory.SEARCH)
            .requiredParameter('criteria', { type: ParameterType.STRING })
            .withHandler({
              handle: async ({ criteria }) => {
                console.log(
                  `[expo-assistant-30] search-products invoked (schema-bound path), criteria="${criteria}"`
                );
                return { ok: true, query: criteria };
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

        <View style={styles.card} testID="card-search-voice">
          <View style={styles.cardHead}>
            <Text style={styles.cardIcon}>🔎</Text>
            <Text style={styles.cardTitle}>Search (voice)</Text>
          </View>

          <Text style={styles.cardSubtitle}>
            Vanilla{' '}
            <Text style={styles.code}>AppIntent</Text> with a primitive{' '}
            <Text style={styles.code}>string</Text> parameter. The bare phrase{' '}
            <Text style={styles.code}>"Search ${'$'}{'{'}'applicationName'{'}'}"</Text>{' '}
            is voice-triggerable; Siri prompts for the query at invocation since
            primitives can't be voice slots (#37).
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Voice test (this path WORKS):</Text>
            <Text style={styles.phrase}>"Hey Siri, search expo-assistant-example"</Text>
            <Text style={styles.helper}>
              → Siri matches the phrase, prompts "What would you like to search
              for?", fires <Text style={styles.code}>search-voice</Text> intent.
              Watch Metro for{' '}
              <Text style={styles.code}>
                [expo-assistant-30] search-voice invoked
              </Text>
              .
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Why this works:</Text>
            <Text style={styles.helper}>
              Vanilla AppIntents with explicit{' '}
              <Text style={styles.code}>phrases[]</Text> templates are Apple's
              supported path for Siri voice triggering. Same path Apple's own
              system apps (Timer, Notes) use under the hood — adapted for
              third-party apps via{' '}
              <Text style={styles.code}>AppShortcutsProvider</Text>.
            </Text>
          </View>
        </View>

        <View style={styles.card} testID="card-search-products-schema">
          <View style={styles.cardHead}>
            <Text style={styles.cardIcon}>✨</Text>
            <Text style={styles.cardTitle}>
              Search Products (schema-bound — AI surface)
            </Text>
          </View>

          <Text style={styles.cardSubtitle}>
            Schema-bound{' '}
            <Text style={styles.code}>@AppIntent(schema: .system.search)</Text>{' '}
            via the #30 plugin path. The schema auto-injects{' '}
            <Text style={styles.code}>criteria: StringSearchCriteria</Text>;
            the plugin unwraps it to a plain string for the JS handler.
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Library tap (this path WORKS):</Text>
            <Text style={styles.phrase}>
              Shortcuts.app → + → "expo-assistant-example" → tap "Search"
            </Text>
            <Text style={styles.helper}>
              → fires <Text style={styles.code}>search-products</Text> intent.
              Watch Metro for{' '}
              <Text style={styles.code}>
                [expo-assistant-30] search-products invoked (schema-bound path)
              </Text>
              . The tile displays under "Search" (schema's default title), not
              "Search Products" — the macro owns title metadata.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Voice DOESN'T work (verified 2026-05-22):
            </Text>
            <Text style={styles.phrase}>
              "Hey Siri, search expo-assistant-example for tacos"
            </Text>
            <Text style={styles.helper}>
              → Siri falls through to web search. Schema intents do NOT route
              via voice phrase matching, even with Apple Intelligence enabled
              on an iPhone 16 Pro. The{' '}
              <Text style={styles.code}>phrases[]</Text> array on a schema
              intent serves as a Shortcuts.app / Spotlight discovery hint, not
              a voice trigger.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>The compose pattern:</Text>
            <Text style={styles.helper}>
              For actions where you want BOTH voice triggering AND AI surfacing
              (Spotlight tiles, onscreen-content suggestions, contextual app
              gallery), declare TWO shortcuts — a vanilla one with explicit
              phrases (see "Search (voice)" above), and a schema-bound one with{' '}
              <Text style={styles.code}>assistantOnly: true</Text> to hide it
              from the Library. Both can route to the same JS logic. See{' '}
              <Text style={styles.code}>
                runbook/integrate-assistant-schema.md
              </Text>
              .
            </Text>
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
