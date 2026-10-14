import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.{ts,mjs}",
      "tests/integration/**/*.test.{ts,mjs}",
    ],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
