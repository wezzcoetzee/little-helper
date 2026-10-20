import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const manifest = (await Bun.file("dist/manifest.json").json()) as {
  background: { service_worker: string };
  action: { default_popup: string };
  side_panel: { default_path: string };
  icons: Record<string, string>;
  content_scripts: { js?: string[]; css?: string[] }[];
};
async function exists(path: string) {
  if (!(await Bun.file(join("dist", path)).exists()))
    throw new Error(`Missing packaged file: ${path}`);
}
await Promise.all(
  [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.side_panel.default_path,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((script) => [
      ...(script.js ?? []),
      ...(script.css ?? []),
    ]),
  ].map(exists),
);
for (const html of ["popup.html", "sidepanel.html", "music.html"]) {
  const text = await Bun.file(`dist/${html}`).text();
  for (const match of text.matchAll(/(?:src|href)="([^"]+)"/g))
    await exists(match[1]);
}
for (const file of await readdir("dist/github-diagrams")) {
  if (!file.endsWith(".js")) continue;
  const text = await Bun.file(`dist/github-diagrams/${file}`).text();
  for (const match of text.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.\/[^"']+\.js)["']/g,
  ))
    await exists(join("github-diagrams", dirname(file), match[1]));
}
const github = await Bun.file("dist/github.js").text();
if (!github.includes("github-diagrams/diagrams.js"))
  throw new Error("GitHub reader lazy diagram entry is missing");
console.log(
  "Package references, UI assets, icons and lazy Mermaid imports verified.",
);
