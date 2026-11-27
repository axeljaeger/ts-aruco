import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

const root = resolve(__dirname, "site");
const original = resolve(__dirname, "reference/js-aruco");

/** Serves the unmodified original js-aruco samples under /original/ and copies them on build. */
function originalDemos(): Plugin {
  let outDir = "";
  return {
    name: "original-demos",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        const prefix = `${server.config.base}original/`;
        if (!url.pathname.startsWith(prefix)) return next();
        const file = resolve(original, decodeURIComponent(url.pathname.slice(prefix.length)));
        if (!file.startsWith(original) || !existsSync(file) || !statSync(file).isFile())
          return next();
        const types: Record<string, string> = {
          html: "text/html",
          js: "text/javascript",
          jpg: "image/jpeg",
        };
        res.setHeader(
          "Content-Type",
          types[file.split(".").pop() ?? ""] ?? "application/octet-stream",
        );
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      cpSync(original, resolve(outDir, "original"), { recursive: true });
    },
  };
}

export default defineConfig({
  root,
  base: process.env.SITE_BASE ?? "./",
  resolve: {
    alias: [
      { find: /^ts-aruco\/webgl2$/, replacement: resolve(__dirname, "src/webgl2/index.ts") },
      { find: /^ts-aruco\/webgpu$/, replacement: resolve(__dirname, "src/webgpu/index.ts") },
      { find: /^ts-aruco$/, replacement: resolve(__dirname, "src/index.ts") },
    ],
    // Babylon Lite is left-handed unless built with this condition; the demos use one
    // right-handed frame everywhere (POSIT, three.js, Babylon.js with useRightHandedSystem).
    conditions: [...defaultClientConditions, "babylon-lite-rh"],
  },
  build: {
    outDir: resolve(__dirname, "site-dist"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        marker: resolve(root, "marker.html"),
        three: resolve(root, "demos/three.html"),
        babylon: resolve(root, "demos/babylon.html"),
        lite: resolve(root, "demos/lite.html"),
      },
    },
  },
  plugins: [originalDemos()],
});
