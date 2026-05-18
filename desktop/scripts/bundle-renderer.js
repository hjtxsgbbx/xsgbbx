import esbuild from "esbuild";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.resolve(MONOREPO_ROOT, "dist-desktop/desktop/renderer");
const SRC_DIR = path.resolve(__dirname, "../renderer");

fs.mkdirSync(OUT_DIR, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(SRC_DIR, "index.tsx")],
  bundle: true,
  outfile: path.join(OUT_DIR, "index.js"),
  format: "iife",
  target: "chrome110",
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  external: [],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "info",
});

fs.cpSync(path.join(SRC_DIR, "index.html"), path.join(OUT_DIR, "index.html"));
console.log("Renderer bundle built successfully.");
