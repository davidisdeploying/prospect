import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("hidden retry controls cannot be re-shown by the base button rule", async () => {
  const css = await readFile(new URL("../src/popup/popup.css", import.meta.url), "utf8");
  const hiddenRule = css.match(/\.panel--hidden\s*\{([^}]*)\}/);

  assert.ok(hiddenRule, "the shared hidden-state rule exists");
  assert.match(
    hiddenRule[1],
    /display\s*:\s*none\s*!important\s*;/,
    "the hidden state wins even though the later .btn rule sets display:block",
  );
});

test("successful capture clears pending state before rendering its result", async () => {
  const source = await readFile(new URL("../src/popup/popup.js", import.meta.url), "utf8");
  const successStart = source.indexOf(".then(function (claim)");
  const failureStart = source.indexOf(".catch(function (err)", successStart);
  const successBranch = source.slice(successStart, failureStart);

  assert.ok(successStart >= 0 && failureStart > successStart, "capture success branch is present");
  assert.ok(successBranch.includes("clearPending();"), "success clears the stored retry payload");
  assert.ok(successBranch.includes("setRetryVisible(false);"), "success hides Retry explicitly");
});
