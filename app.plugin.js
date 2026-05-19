// Tells Expo's config-plugin resolver where the plugin lives.
// The `app.plugin` field in package.json should be sufficient under
// newer SDKs, but the fallback resolution path looks for this file
// specifically — providing it makes plugin loading work consistently
// across Expo CLI versions.
module.exports = require("./plugin/build");
