import { useEffect, useRef, useState } from 'react';
import { Button, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import {
  IntentCategory,
  ParameterType,
  VoiceAssistant,
  VoiceIntentBuilder,
} from 'expo-assistant';

export default function App() {
  const [status, setStatus] = useState('idle');
  const assistantRef = useRef<VoiceAssistant | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const va = await VoiceAssistant.initialize({ debugMode: true });
        assistantRef.current = va;
        const intent = VoiceIntentBuilder.create<{ query: string }>()
          .withId('search')
          .withCategory(IntentCategory.SEARCH)
          .requiredParameter('query', { type: ParameterType.STRING })
          .withHandler({
            handle: async ({ query }) => {
              setStatus(`got query: ${query}`);
              return { ok: true };
            },
          })
          .build();
        await va.registerIntent(intent);
        setStatus('registered');
      } catch (e: any) {
        setStatus(`error: ${e?.message ?? String(e)}`);
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.header}>expo-assistant example</Text>
        <Text testID="status" style={styles.status}>
          {status}
        </Text>
        <Button
          testID="donate"
          title="Donate search intent"
          onPress={() => {
            assistantRef.current
              ?.donateIntent('search', { query: 'maestro' })
              .then(() => setStatus('donated'))
              .catch((e: any) =>
                setStatus(`donate error: ${e?.message ?? String(e)}`)
              );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    padding: 24,
  },
  header: { fontSize: 24, fontWeight: '600' },
  status: { fontSize: 16, color: '#444' },
});
