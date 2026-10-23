import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // The heavy component suites (form builder, workflow editor) render whole
    // modules in jsdom. Each finishes in a few seconds alone, but the suite
    // runs ~90 files in parallel and that contention pushed the slowest past a
    // 15s budget. Raised so a loaded machine reports real failures rather than
    // timeouts; individual tests still set their own limit where they need more.
    testTimeout: 30_000,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "server/**/*.{test,spec}.{ts,tsx}",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
