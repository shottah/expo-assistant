# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0](https://github.com/shottah/expo-assistant/compare/v0.2.0...v0.3.0) (2026-05-23)


### Features

* **ios:** AssistantSchemas conformance — first cut, system.search ([#50](https://github.com/shottah/expo-assistant/issues/50)) ([f1be192](https://github.com/shottah/expo-assistant/commit/f1be192ba2d60f8458842e7269df822b2f26e69b)), closes [#30](https://github.com/shottah/expo-assistant/issues/30)


### Documentation

* **plugin:** add SCOPE.md + compose-with-expo-widgets runbook ([#49](https://github.com/shottah/expo-assistant/issues/49)) ([d7b6266](https://github.com/shottah/expo-assistant/commit/d7b6266c98e1e297f26f7239af5fec9acad31d9f))


### Refactor

* **plugin:** split iOS plugin into per-concern modules + codegen/ ([#46](https://github.com/shottah/expo-assistant/issues/46)) ([cd45810](https://github.com/shottah/expo-assistant/commit/cd45810eb61e3e8342b639377c2f5611160be551))

## [0.2.0](https://github.com/shottah/expo-assistant/compare/v0.1.0...v0.2.0) (2026-05-20)


### Features

* implement config plugin for voice assistant automation ([7b1e907](https://github.com/shottah/expo-assistant/commit/7b1e90741a0005666e8b8e0fb5e5488fd2407f67))
* implement expo-assistant voice module with TDD ([cbd2d73](https://github.com/shottah/expo-assistant/commit/cbd2d73bc449bbad1d8ecfca591a7cfb818e556e))
* **ios:** AppEntity + EntityStringQuery support via async resolver bridge (closes [#28](https://github.com/shottah/expo-assistant/issues/28)) ([#43](https://github.com/shottah/expo-assistant/issues/43)) ([81df11e](https://github.com/shottah/expo-assistant/commit/81df11e43083a3134eccd84c86eb903d396558ff))
* **ios:** AppEnum + rich primitive types (Date, Duration, Length, URL) (closes [#29](https://github.com/shottah/expo-assistant/issues/29)) ([#40](https://github.com/shottah/expo-assistant/issues/40)) ([6dbf591](https://github.com/shottah/expo-assistant/commit/6dbf591463e8e736e495bd5486e55412e9e312d6))
* **ios:** AppShortcuts bridge + prebuild codegen — iOS voice-trigger to JS handler ([#22](https://github.com/shottah/expo-assistant/issues/22)) ([3f73c79](https://github.com/shottah/expo-assistant/commit/3f73c79d5a521db76113dd5c153f1fbd15fb891d))
* **ios:** donate via IntentDonationManager.shared (closes [#19](https://github.com/shottah/expo-assistant/issues/19)) ([#27](https://github.com/shottah/expo-assistant/issues/27)) ([6a92d89](https://github.com/shottah/expo-assistant/commit/6a92d8932883e852f3998461c7fd91e4aa4955fe))
* **ios:** per-shortcut typed AppIntent codegen with multi-param support (closes [#25](https://github.com/shottah/expo-assistant/issues/25)) ([#39](https://github.com/shottah/expo-assistant/issues/39)) ([59f4b0a](https://github.com/shottah/expo-assistant/commit/59f4b0aba8a0b2947ec7a1e151f32766d16f2330))
* **js:** add onIntentInvoked event channel ([#16](https://github.com/shottah/expo-assistant/issues/16)) ([0b02440](https://github.com/shottah/expo-assistant/commit/0b024401d0b9cbfdb5f7f1e5e70402e130c6fecf))


### Documentation

* add comprehensive config plugin documentation ([2eb39ee](https://github.com/shottah/expo-assistant/commit/2eb39ee83b048dd3396d61d615c19cb104c42b39))
* add comprehensive README with installation and usage guide ([cc8ee97](https://github.com/shottah/expo-assistant/commit/cc8ee97ec84a69e363f4d8ed33315322b3ca5421))
* add comprehensive TODO.md with feature tracking ([3da31e4](https://github.com/shottah/expo-assistant/commit/3da31e46e872070dfc571a914de6b8904880358c))
* consolidate per plan 04 ([#9](https://github.com/shottah/expo-assistant/issues/9)) ([d847760](https://github.com/shottah/expo-assistant/commit/d8477600bbbae82c7c72525e5549850cad7f112b))


### Refactor

* collapse VoiceAssistant.setup into initialize (closes [#20](https://github.com/shottah/expo-assistant/issues/20)) ([#26](https://github.com/shottah/expo-assistant/issues/26)) ([0729ce6](https://github.com/shottah/expo-assistant/commit/0729ce6c7fa5e7612c40a3439931a13c9070f6f9))

## [0.1.0]

### Added
- Initial scaffold of `expo-assistant`: TypeScript fluent intent builder (`VoiceIntentBuilder`), runtime orchestration (`VoiceAssistant`), config plugin for iOS Info.plist / entitlements / SiriKit setup and Android manifest / shortcuts.xml / App Actions setup, stub native modules for iOS and Android.
