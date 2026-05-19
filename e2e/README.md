# E2E

Maestro flows that exercise the example app end-to-end.

## Prerequisites

- Maestro CLI: `curl -Ls "https://get.maestro.mobile.dev" | bash`
- A running iOS Simulator or Android emulator
- The example app installed on the device:

  ```bash
  cd example
  bun install
  bunx expo prebuild --platform android --clean --no-install   # or --platform ios
  bun run android                                               # or bun run ios
  ```

## Running

```bash
maestro test e2e/maestro/register-and-donate.yaml
```

## Flows

- `register-and-donate.yaml` — verifies `VoiceAssistant.initialize() → registerIntent() → donateIntent()` round-trips through the native module.
