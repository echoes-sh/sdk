import { defineConfig } from "tsup";

export default defineConfig([
  // Main entry (core client)
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    minify: true,
  },
  // React entry (widget components)
  {
    entry: ["src/react.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    minify: true,
    external: ["react"],
  },
]);
