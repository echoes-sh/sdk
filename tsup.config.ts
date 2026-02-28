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
  // CLI entry
  {
    entry: { cli: "src/cli/index.ts" },
    outDir: "dist",
    format: ["cjs"],
    dts: false,
    sourcemap: false,
    treeshake: true,
    minify: false,
    shims: true,
  },
  // Browser entry (IIFE for CDN distribution)
  {
    entry: { experiments: "src/experiments/browser.ts" },
    outDir: "dist",
    format: ["iife"],
    globalName: "EchoesExperiments",
    dts: false,
    sourcemap: true,
    treeshake: true,
    minify: true,
    outExtension: () => ({ js: ".min.js" }),
    platform: "browser",
    target: "es2020",
  },
]);
