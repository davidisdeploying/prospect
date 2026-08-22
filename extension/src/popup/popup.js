(function () {
  "use strict";

  var PENDING_KEY = "prospectPendingCapture";

  var panels = {
    idle: document.getElementById("idle"),
    settings: document.getElementById("settings"),
    loading: document.getElementById("loading"),
    review: document.getElementById("review"),
    result: document.getElementById("result"),
    unsupported: document.getElementById("unsupported"),
  };

  function show(name) {
    Object.keys(panels).forEach(function (key) {
      panels[key].classList.toggle("panel--hidden", key !== name);
    });
  }

  var pendingBody = null; // the last built claim body, kept for retry within this popup session
  var sessionActed = false; // set once this popup has submitted anything, so the async pending
                            // restore below can never overwrite a result the user is looking at
  var submitting = false; // re-entrancy guard covering both confirmBtn and retryBtn

  function savePending(body) {
    pendingBody = body;
    var payload = {};
    payload[PENDING_KEY] = { body: body, savedAt: new Date().toISOString() };
    chrome.storage.local.set(payload);
  }

  function clearPending() {
    pendingBody = null;
    chrome.storage.local.remove(PENDING_KEY);
    setRetryVisible(false);
  }

  // Retry is only ever offered when there is genuinely something to retry. Observed 2026-08-09:
  // a Scout-enrichment success message rendered with Retry as its primary button. (The literal
  // message text is deliberately not quoted here -- test/scout-extension-message.test.mjs uses
  // those strings as positional markers, and a copy in a comment breaks its ordering check.)
  // Clicking it was already harmless -- clearPending() nulls pendingBody and the
  // handler is a no-op without one, which is why no duplicate claim was created -- but presenting
  // resubmission as the obvious next step after success is exactly H12's failure mode drawn as a
  // button, and it invites the user to believe the capture did not land.
  function setRetryVisible(visible) {
    sessionActed = true;
    var retryBtn = document.getElementById("retryBtn");
    if (!retryBtn) return;
    if (visible && pendingBody) retryBtn.classList.remove("panel--hidden");
    else retryBtn.classList.add("panel--hidden");
  }

  function humanizeEnum(value) {
    return String(value).replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // fields.description arrives as cleaned (allowlisted) HTML from the
  // adapter's cleanDescriptionHtml() -- strip tags for this plain-text popup
  // preview only; the stored/staked value keeps the real markup untouched.
  function stripTagsForPreview(html, maxLen) {
    var text = String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }

  function renderFields(fields, missing) {
    var dl = document.getElementById("fieldList");
    dl.innerHTML = "";
    ["role", "company", "location", "comp", "employment_type", "workplace_type", "seniority", "posted_at", "description"].forEach(function (key) {
      var dt = document.createElement("dt");
      dt.textContent = humanizeEnum(key);
      var dd = document.createElement("dd");
      var value = fields[key];
      if (!value && value !== false) {
        dd.textContent = "(not found)";
      } else if (key === "comp") {
        var compText = value;
        if (fields.salary_min != null && fields.salary_period) compText += " (annualizes on save)";
        dd.textContent = compText;
      } else if (key === "description") {
        dd.textContent = stripTagsForPreview(value, 200);
      } else if (key === "employment_type" || key === "workplace_type" || key === "seniority") {
        dd.textContent = humanizeEnum(value);
      } else {
        dd.textContent = value;
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    });

    var longTailNote = document.getElementById("longTailNote");
    if (longTailNote) {
      var longTailKeys = fields.parsed && typeof fields.parsed === "object"
        ? Object.keys(fields.parsed).filter(function (k) { return k !== "parsed_by" && k !== "sections"; })
        : [];
      longTailNote.textContent = longTailKeys.length
        ? "Captured " + longTailKeys.length + " extra field" + (longTailKeys.length === 1 ? "" : "s") + ": " + longTailKeys.join(", ")
        : "";
    }

    var note = document.getElementById("missingNote");
    note.textContent = missing && missing.length ? "Missing: " + missing.join(", ") : "";
  }

  function runCapture() {
    show("loading");
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs[0];
      if (!tab || !tab.id) {
        show("unsupported");
        return;
      }
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ProspectAdapters.registry.fileList() },
        function () {
          if (chrome.runtime.lastError) {
            document.getElementById("resultMessage").textContent =
              "Couldn't read this page: " + chrome.runtime.lastError.message;
            setRetryVisible(false);
            show("result");
            return;
          }
          chrome.scripting.executeScript(
            {
              target: { tabId: tab.id },
              func: function () {
                return window.__prospectCollect ? window.__prospectCollect() : { error: "collector not injected" };
              },
            },
            function (results) {
              if (chrome.runtime.lastError || !results || !results[0]) {
                document.getElementById("resultMessage").textContent =
                  "Couldn't read this page: " + (chrome.runtime.lastError ? chrome.runtime.lastError.message : "no result");
                setRetryVisible(false);
                show("result");
                return;
              }
              var collected = results[0].result;
              if (!collected || collected.error) {
                show("unsupported");
                return;
              }
              window.__prospectLastResult = collected.result;
              renderFields(collected.result.fields, collected.result.missing);
              show("review");
            }
          );
        }
      );
    });
  }

  function submitClaim(body) {
    if (submitting) return;
    submitting = true;
    var confirmBtn = document.getElementById("confirmBtn");
    var retryBtn = document.getElementById("retryBtn");
    if (confirmBtn) confirmBtn.disabled = true;
    if (retryBtn) retryBtn.disabled = true;

    show("loading");
    ProspectConfig.getEndpoint().then(function (endpoint) {
      ProspectCapture.postClaim(endpoint, body)
        .then(function (claim) {
          clearPending();
          var message = "Claim staked.";
          if (claim && claim.duplicate_capture) {
            message = "Claim #" + claim.claim_id + " is already current · no duplicate created.";
          } else if (claim && claim.refreshed_existing_claim) {
            message = "Claim #" + claim.claim_id + " refreshed · snapshot generation " + claim.snapshot_generation + ".";
          } else if (claim && claim.repost_candidate) {
            message = "Claim staked · possible repost — see claim #" + claim.repost_candidate.prior_claim_id + " in Prospect";
          } else if (claim && claim.scout_enriched) {
            message = "Claim staked · Scout lead enriched & linked.";
          }
          document.getElementById("resultMessage").textContent = message;
          setRetryVisible(false);
          show("result");
          submitting = false;
          if (confirmBtn) confirmBtn.disabled = false;
          if (retryBtn) retryBtn.disabled = false;
        })
        .catch(function (err) {
          savePending(body);
          var message = "Couldn't reach Prospect — capture saved, retry.";
          if (err && typeof err.status === "number") {
            message = "Import failed: " + err.message + " — capture saved, retry.";
          }
          document.getElementById("resultMessage").textContent = message;
          setRetryVisible(true);
          show("result");
          submitting = false;
          if (confirmBtn) confirmBtn.disabled = false;
          if (retryBtn) retryBtn.disabled = false;
        });
    }).catch(function () {
      savePending(body);
      document.getElementById("resultMessage").textContent =
        "Couldn't reach Prospect — capture saved, retry.";
      setRetryVisible(true);
      show("result");
      submitting = false;
      if (confirmBtn) confirmBtn.disabled = false;
      if (retryBtn) retryBtn.disabled = false;
    });
  }

  document.getElementById("captureBtn").addEventListener("click", runCapture);

  document.getElementById("confirmBtn").addEventListener("click", function () {
    var lastResult = window.__prospectLastResult;
    if (!lastResult) return;
    var body = ProspectCapture.buildClaimBody(lastResult);
    submitClaim(body);
  });

  document.getElementById("cancelBtn").addEventListener("click", function () {
    show("idle");
  });

  document.getElementById("retryBtn").addEventListener("click", function () {
    if (pendingBody) submitClaim(pendingBody);
  });

  document.getElementById("doneBtn").addEventListener("click", function () {
    window.close();
  });

  document.getElementById("settingsToggle").addEventListener("click", function () {
    ProspectConfig.getEndpoint().then(function (endpoint) {
      document.getElementById("endpointInput").value = endpoint;
      document.getElementById("settingsStatus").textContent = "";
      show("settings");
    });
  });

  document.getElementById("settingsCancel").addEventListener("click", function () {
    show("idle");
  });

  document.getElementById("settingsSave").addEventListener("click", function () {
    var value = document.getElementById("endpointInput").value.trim();
    if (!value) return;
    ProspectConfig.setEndpoint(value).then(function (granted) {
      var status = document.getElementById("settingsStatus");
      if (granted) {
        status.textContent = "Saved.";
      } else {
        status.textContent = "Permission denied — endpoint not changed.";
      }
    });
  });

  // On open, surface any capture that failed to send in a previous session. This is an ASYNC
  // callback, so it can land after the user has already captured something in this session -- in
  // which case it must stay out of the way rather than repaint the result panel underneath them.
  chrome.storage.local.get([PENDING_KEY], function (items) {
    if (sessionActed) return;
    var pending = items && items[PENDING_KEY];
    if (pending && pending.body) {
      pendingBody = pending.body;
      document.getElementById("resultMessage").textContent =
        "A capture from " + pending.savedAt + " couldn't reach Prospect — retry?";
      setRetryVisible(true);
      show("result");
    } else {
      show("idle");
    }
  });
})();
