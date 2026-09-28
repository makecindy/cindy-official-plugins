import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(path.dirname(fileURLToPath(import.meta.url)));
const out = "../..",
  root = path.resolve("../latest");
const r = await build({
  absWorkingDir: process.cwd(),
  entryPoints: ["FullStudio.tsx"],
  bundle: true,
  outfile: out + "/assets/studio.js",
  format: "iife",
  platform: "browser",
  target: "chrome120",
  jsx: "automatic",
  minify: true,
  metafile: true,
  nodePaths: [path.resolve("node_modules")],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "eof",
  loader: { ".woff2": "dataurl", ".png": "dataurl", ".svg": "dataurl" },
  plugins: [
    {
      name: "workspace",
      setup(b) {
        b.onResolve({ filter: /^@open-design\// }, (a) => {
          const [name, ...rest] = a.path.slice(13).split("/");
          let p =
            root + "/packages/" + name + "/src/" + (rest.join("/") || "index");
          for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ".css"])
            if (fs.existsSync(p + ext)) return { path: p + ext };
          return undefined;
        });
        b.onResolve({ filter: /^\// }, (a) => ({
          path: a.path,
          external: true,
        }));
      },
    },
  ],
});
const cardBuild = await build({
  absWorkingDir: process.cwd(),
  entryPoints: ["card-preview.cjs"],
  bundle: true,
  outfile: out + "/node/card-preview.cjs",
  platform: "node",
  format: "cjs",
  target: "node22",
  minify: true,
  metafile: true,
  alias: { cheerio: "cheerio/slim" },
});
Object.assign(r.metafile.inputs, cardBuild.metafile.inputs);
fs.copyFileSync("bridge-main.js", out + "/main.js");
fs.writeFileSync("build-meta.json", JSON.stringify(r.metafile, null, 2));
console.log("Built", Object.keys(r.metafile.inputs).length, "modules");
