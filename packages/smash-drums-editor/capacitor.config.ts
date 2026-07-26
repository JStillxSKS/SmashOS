import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android APK wrapper around the Vite web editor.
 * Desktop Electron builds are unchanged.
 */
const config: CapacitorConfig = {
  appId: "com.smashdrums.editor",
  appName: "Smash Drums Editor",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: true,
    backgroundColor: "#000000",
  },
  plugins: {
    // Keep back-button from exiting mid-edit; App plugin can listen in future.
  },
};

export default config;
