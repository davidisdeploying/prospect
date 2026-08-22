import assert from "node:assert/strict";
import { lstat, readFile, readlink } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const wrapper = path.join(repository, "apple", "Prospect for Safari");

test("Safari wrapper consumes the canonical WebExtension resources", async () => {
  const resources = path.join(wrapper, "Shared (Extension)", "Resources");
  assert.equal((await lstat(resources)).isSymbolicLink(), true);
  assert.equal(await readlink(resources), "../../../extension");
});

test("Safari wrapper uses the approved two-ID budget across platforms", async () => {
  const project = await readFile(
    path.join(wrapper, "Prospect for Safari.xcodeproj", "project.pbxproj"),
    "utf8",
  );
  assert.equal(
    project.match(/PRODUCT_BUNDLE_IDENTIFIER = cc\.davidgomez\.prospect\.safari;/g)?.length,
    4,
  );
  assert.equal(
    project.match(/PRODUCT_BUNDLE_IDENTIFIER = cc\.davidgomez\.prospect\.safari\.Extension;/g)?.length,
    4,
  );
});

test("Safari wrapper preserves capture and tailnet transport gates", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repository, "extension", "manifest.json"), "utf8"),
  );
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://alpha.tail3327f9.ts.net:8443/*",
    "http://alpha.tail3327f9.ts.net:8787/*",
  ]);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);

  const sources = await readFile(
    path.join(repository, "extension", "src", "lib", "config.js"),
    "utf8",
  );
  assert.equal(sources.includes("service token"), false);
});
