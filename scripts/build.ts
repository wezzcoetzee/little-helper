import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dir, "..");
process.chdir(root);
async function bundle(
  entry: string,
  outfile: string,
  format: "iife" | "esm" = "iife",
  splitting = false,
) {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: `dist/${outfile.split("/").slice(0, -1).join("/")}`,
    naming: {
      entry: outfile.split("/").at(-1)!.replace(/\.js$/, ".[ext]"),
      chunk: "[name]-[hash].[ext]",
      asset: "[name]-[hash].[ext]",
    },
    format,
    splitting,
    minify: true,
    target: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success)
    throw new AggregateError(result.logs, `Build failed: ${entry}`);
}
async function build() {
  await rm("dist", { recursive: true, force: true });
  await mkdir("dist/browser", { recursive: true });
  await cp("public", "dist", { recursive: true });
  await cp("manifest.json", "dist/manifest.json");
  const packages: string[] = [];
  for (const entry of await readdir("node_modules", { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      for (const child of await readdir(`node_modules/${entry.name}`))
        packages.push(`node_modules/${entry.name}/${child}`);
    } else packages.push(`node_modules/${entry.name}`);
  }
  const notices: string[] = [];
  for (const directory of packages.sort()) {
    const packageFile = Bun.file(`${directory}/package.json`);
    if (!(await packageFile.exists())) continue;
    const info = (await packageFile.json()) as {
      name: string;
      version: string;
    };
    const files = await readdir(directory);
    for (const file of files.filter((name) =>
      /^(license|licence|copying)([.-]|$)/i.test(name),
    )) {
      const license = Bun.file(`${directory}/${file}`);
      if (await license.exists())
        notices.push(
          `${info.name}@${info.version} (${file})\n${await license.text()}`,
        );
    }
  }
  await Bun.write(
    "dist/third-party-notices.txt",
    notices.join("\n\n" + "=".repeat(72) + "\n\n"),
  );
  for (const file of await readdir("src/browser"))
    if (file.endsWith(".js"))
      await cp(`src/browser/${file}`, `dist/browser/${file}`);
  for (const size of [16, 32, 48, 128])
    await sharp("public/icons/icon.svg")
      .resize(size, size)
      .png()
      .toFile(`dist/icons/icon${size}.png`);
  await bundle("src/background/index.ts", "background.js", "esm");
  await bundle("src/clipper/content.ts", "clipper.js");
  await bundle("src/github/entry.js", "github.js");
  await bundle(
    "src/github/diagrams.js",
    "github-diagrams/diagrams.js",
    "esm",
    true,
  );
  await bundle("src/ui/main.tsx", "ui/popup.js", "esm");
  await bundle("src/ui/panel.tsx", "ui/panel.js", "esm");
  await bundle("src/ui/music-main.tsx", "ui/music.js", "esm");
  console.log(
    "Built little-helper → dist/ (load this folder in chrome://extensions)",
  );
}
await build();
if (process.argv.includes("--watch")) {
  const { watch } = await import("node:fs");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let rebuilding = false;
  const rebuild = async () => {
    if (rebuilding) {
      pending = true;
      return;
    }
    rebuilding = true;
    try {
      await build();
    } catch (error) {
      console.error(error);
    } finally {
      rebuilding = false;
      if (pending) {
        pending = false;
        void rebuild();
      }
    }
  };
  for (const path of ["src", "public", "manifest.json"])
    watch(path, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void rebuild();
      }, 200);
    });
  console.log("Watching sources. Reload the unpacked extension after changes.");
}
