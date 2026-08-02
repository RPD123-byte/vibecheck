import { build } from "vite";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const electronRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const output = path.resolve(
  electronRoot,
  "../../dist/component-reactions/browser-extension",
);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await bundle("content", "src/browser-extension/content.ts", true);
await bundle("background", "src/browser-extension/background.ts", false);

const manifest = JSON.parse(
  await readFile(
    path.join(electronRoot, "browser-extension/manifest.json"),
    "utf8",
  ),
);
const packageManifest = JSON.parse(
  await readFile(path.join(electronRoot, "package.json"), "utf8"),
);
manifest.version = packageManifest.version;
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
await cp(
  path.join(electronRoot, "resources/app-icon-1024.png"),
  path.join(output, "icon128.png"),
);
await cp(
  path.join(
    electronRoot,
    "src/component-reactions/renderer-style.css",
  ),
  path.join(output, "content.css"),
);

async function bundle(name, entry, emptyOutDir) {
  await build({
    configFile: false,
    root: electronRoot,
    logLevel: "warn",
    build: {
      target: ["chrome120", "safari17"],
      outDir: output,
      emptyOutDir,
      sourcemap: false,
      minify: "esbuild",
      lib: {
        entry: path.join(electronRoot, entry),
        name: `Vibecheck${name[0].toUpperCase()}${name.slice(1)}`,
        formats: ["iife"],
        fileName: () => `${name}.js`,
      },
    },
  });
}
