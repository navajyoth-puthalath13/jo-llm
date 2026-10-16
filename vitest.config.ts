import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // Mirrors wrangler's Text rule: `import x from "./file.md"` gives the file as a string.
      name: "md-as-text",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".md")) return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
