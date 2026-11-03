import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

const watch = process.argv[2] === "watch";
const outdir = process.env.OUT_DIR || "dist";
mkdirSync(outdir, { recursive: true });

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  treeShaking: true,
  outfile: `${outdir}/main.js`,
  plugins: [{
    name: "copy-assets",
    setup(build) {
      build.onEnd(() => {
        copyFileSync("manifest.json", `${outdir}/manifest.json`);
        copyFileSync("styles.css", `${outdir}/styles.css`);
      });
    },
  }],
});

if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
