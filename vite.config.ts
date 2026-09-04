import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createLogger, defineConfig, type Logger, type LogOptions, type LogErrorOptions, type Plugin } from "vite";

import { accessEnd, logLine } from "./src/access-log.ts";

const defaultLogger = createLogger("info", { allowClearScreen: false });
const timestamped = (level: "info" | "warn" | "error", message: string, options?: LogOptions) => {
  if (options?.timestamp) {
    logLine("web", message, level);
    return true;
  }
  return false;
};
const viteLogger: Logger = {
  hasWarned: false,
  info(message, options) {
    if (!timestamped("info", message, options)) defaultLogger.info(message, { ...options, clear: false });
  },
  warn(message, options) {
    this.hasWarned = true;
    if (!timestamped("warn", message, options)) defaultLogger.warn(message, { ...options, clear: false });
  },
  warnOnce(message, options) {
    this.hasWarned = true;
    defaultLogger.warnOnce(message, { ...options, clear: false, timestamp: false });
  },
  error(message, options?: LogErrorOptions) {
    this.hasWarned = true;
    if (!timestamped("error", message, options)) defaultLogger.error(message, { ...options, clear: false });
  },
  clearScreen() {},
  hasErrorLogged(error) {
    return defaultLogger.hasErrorLogged(error);
  },
};

const accessLogger = {
  name: "hawk-access-logger",
  configureServer(server: import("vite").ViteDevServer) {
    server.middlewares.use((request, response, next) => {
      const acceptsHtml = request.headers.accept?.includes("text/html");
      if (!acceptsHtml || request.url?.startsWith("/api")) return next();
      const startedAt = performance.now();
      const url = request.url ?? "/";
      response.once("finish", () => {
        accessEnd("web", request.method ?? "GET", url, response.statusCode, performance.now() - startedAt);
      });
      next();
    });
  },
};

const pwaPrecache = (): Plugin => ({
  name: "hawk-pwa-precache",
  async closeBundle() {
    const output = fileURLToPath(new URL("./dist/", import.meta.url));
    const assetNames = (await readdir(new URL("./assets/", new URL(output, "file:"))))
      .sort()
      .map((name) => `./assets/${name}`);
    const shellAssets = [
      "./",
      "./index.html",
      "./manifest.webmanifest",
      "./favicon.svg",
      "./icons/icon.svg",
      "./icons/icon-maskable.svg",
      "./icons/icon-192.png",
      "./icons/icon-512.png",
      "./icons/icon-maskable-512.png",
      ...assetNames,
    ];
    const buildId = createHash("sha256").update(shellAssets.join("\n")).digest("hex").slice(0, 12);
    const serviceWorkerUrl = new URL("./service-worker.js", new URL(output, "file:"));
    const source = await readFile(serviceWorkerUrl, "utf8");
    const built = source
      .replace('const CACHE_NAME = "hawk-shell-v1";', `const CACHE_NAME = "hawk-shell-${buildId}";`)
      .replace(
        /const PRECACHE_ASSETS = \/\* __PRECACHE_ASSETS__ \*\/ \[[\s\S]*?\n\];/,
        `const PRECACHE_ASSETS = ${JSON.stringify(shellAssets, null, 2)};`,
      );
    await writeFile(serviceWorkerUrl, built);
  },
});

export default defineConfig({
  clearScreen: false,
  customLogger: viteLogger,
  // Streamlit mounts this app under /~/+/, so every asset URL must be relative.
  base: "./",
  plugins: [accessLogger, react(), tailwindcss(), pwaPrecache()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/client", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api/catalog": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:9000",
        changeOrigin: true,
      },
    },
  },
});
