import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function prospectPwaPlugin() {
  return {
    name: "prospect-pwa-sw-generator",
    writeBundle(options, bundle) {
      const outDir = options.dir || path.resolve(__dirname, "dist");
      const assetFiles = Object.keys(bundle)
        .filter((file) => file.startsWith("assets/"))
        .sort()
        .map((file) => "/" + file);

      const swSourcePath = path.resolve(__dirname, "src/sw.js");
      if (!fs.existsSync(swSourcePath)) return;

      const swTemplate = fs.readFileSync(swSourcePath, "utf8");
      const buildDigest = crypto.createHash("sha256");
      buildDigest.update(swTemplate);

      for (const assetUrl of assetFiles) {
        const fileName = assetUrl.slice(1);
        const output = bundle[fileName];
        buildDigest.update(fileName);
        buildDigest.update(output.type === "chunk" ? output.code : Buffer.from(output.source));
      }

      for (const fileName of [
        "manifest.webmanifest",
        "offline.html",
        "pwa-register.js",
        "scout-push.js",
        "icon-192.png",
        "icon-512.png",
        "apple-touch-icon.png",
      ]) {
        const filePath = path.resolve(__dirname, "public", fileName);
        buildDigest.update(fileName);
        buildDigest.update(fs.readFileSync(filePath));
      }

      const buildHash = buildDigest.digest("hex").slice(0, 12);

      const swContent = swTemplate
        .replace("__BUILD_HASH__", buildHash)
        .replace("__PRECACHE_ASSETS__", JSON.stringify(assetFiles, null, 2));

      fs.writeFileSync(path.join(outDir, "sw.js"), swContent);
    },
  };
}

export default defineConfig({
  plugins: [react(), prospectPwaPlugin()],
  resolve: {
    alias: {
      "@ds": path.resolve(__dirname, "../design-system"),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
