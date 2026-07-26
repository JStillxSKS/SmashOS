import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    // 0.0.0.0 so Android phones on the same LAN can open the dev server
    host: true,
    port: 5174,
  },
});
