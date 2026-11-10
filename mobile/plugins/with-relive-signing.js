// Expo config plugin: signs Android release builds with the private Relive key instead of the public
// React Native debug key, and refuses to build a release without it. Survives `expo prebuild --clean`.
// The key itself never lives in git: keystore.properties is read from RELIVE_KEYSTORE_PROPS
// (default /home/claude/relive-signing/keystore.properties). Backup: Mac, Documents/CRM Re-Design/relive-android-signing.
const { withAppBuildGradle } = require("expo/config-plugins");

const LOAD = `
    def reliveProps = new Properties()
    def relivePropsFile = file(System.getenv("RELIVE_KEYSTORE_PROPS") ?: "/home/claude/relive-signing/keystore.properties")
    if (relivePropsFile.exists()) { relivePropsFile.withInputStream { reliveProps.load(it) } }
    signingConfigs {
        if (reliveProps["RELIVE_STORE_FILE"]) {
            release {
                storeFile file(reliveProps["RELIVE_STORE_FILE"])
                storePassword reliveProps["RELIVE_STORE_PASSWORD"]
                keyAlias reliveProps["RELIVE_KEY_ALIAS"]
                keyPassword reliveProps["RELIVE_KEY_PASSWORD"]
            }
        }`;

module.exports = function withReliveSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let s = c.modResults.contents;
    if (s.includes("reliveProps")) return c;
    s = s.replace(/\n    signingConfigs \{/, LOAD);
    s = s.replace(/(buildTypes \{[\s\S]*?\n        release \{[\s\S]*?)signingConfig signingConfigs\.debug/, (_m, head) =>
      `${head}if (!reliveProps["RELIVE_STORE_FILE"]) { throw new GradleException("Release builds need the Relive signing key (keystore.properties).") }\n            signingConfig signingConfigs.release`);
    c.modResults.contents = s;
    return c;
  });
};
