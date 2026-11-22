import { defineConfig } from "vite";
export default defineConfig({
  publicDir: "harness/web/public",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/target/**", "**/test-reports/**", "**/docs/evidence/**"],
    },
  },
  build: {
    outDir: "target/harness-web",
    rollupOptions: {
      input: ["harness/web/index.html", "harness/web/m12.html", "harness/web/m14.html", "languages/fmea/web/index.html", "previews/m12/index.html"],
    },
  },
});
