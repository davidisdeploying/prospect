/* Prospect Scout Web Push Progressive Helper */

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function initScoutPush() {
  if ('clearAppBadge' in navigator) {
    try { navigator.clearAppBadge(); } catch {}
  }

  const card = document.getElementById('scout-push-card');
  const statusEl = document.getElementById('scout-push-status');
  const enableBtn = document.getElementById('push-enable-btn');
  const testBtn = document.getElementById('push-test-btn');
  const disableBtn = document.getElementById('push-disable-btn');
  const preferencesEl = document.getElementById('push-preferences');
  const scoutPref = document.getElementById('push-pref-scout');
  const todayPref = document.getElementById('push-pref-today');
  const quietPref = document.getElementById('push-pref-quiet');
  const quietStart = document.getElementById('push-pref-start');
  const quietEnd = document.getElementById('push-pref-end');
  const savePreferencesBtn = document.getElementById('push-save-preferences');

  if (!card || !enableBtn) return;

  const isSupported = ('serviceWorker' in navigator) &&
                      ('PushManager' in window) &&
                      ('Notification' in window);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;

  if (!isSupported || !isStandalone) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'grid';

  let registration;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch (err) {
    statusEl.textContent = 'Service worker not ready.';
    return;
  }

  async function updateUI() {
    try {
      const sub = await registration.pushManager.getSubscription();
      if (sub && Notification.permission === 'granted') {
        statusEl.textContent = 'Web Push notifications are active on this device.';
        const statusRes = await fetch(`/api/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`);
        const statusData = await statusRes.json();
        if (statusRes.ok && statusData.preferences) {
          scoutPref.checked = statusData.preferences.scout_enabled;
          todayPref.checked = statusData.preferences.today_enabled;
          quietPref.checked = statusData.preferences.quiet_hours_enabled;
          quietStart.value = statusData.preferences.quiet_start;
          quietEnd.value = statusData.preferences.quiet_end;
        }
        preferencesEl.style.display = 'block';
        enableBtn.style.display = 'none';
        testBtn.style.display = 'inline-block';
        disableBtn.style.display = 'inline-block';
      } else {
        statusEl.textContent = Notification.permission === 'denied'
          ? 'Notifications blocked in browser settings.'
          : 'Notifications disabled.';
        preferencesEl.style.display = 'none';
        enableBtn.style.display = 'inline-block';
        testBtn.style.display = 'none';
        disableBtn.style.display = 'none';
      }
    } catch (err) {
      statusEl.textContent = 'Unable to read notification status.';
    }
  }

  enableBtn.addEventListener('click', async () => {
    enableBtn.disabled = true;
    statusEl.textContent = 'Requesting permission...';
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        statusEl.textContent = 'Notification permission was not granted.';
        enableBtn.disabled = false;
        await updateUI();
        return;
      }

      statusEl.textContent = 'Fetching VAPID configuration...';
      const keyRes = await fetch('/api/push/vapid-public-key');
      const keyData = await keyRes.json();

      if (!keyRes.ok || !keyData.enabled || !keyData.publicKey) {
        statusEl.textContent = 'Push server is disabled or unconfigured.';
        enableBtn.disabled = false;
        return;
      }

      statusEl.textContent = 'Subscribing device...';
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      });

      const subObj = sub.toJSON();
      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subObj.endpoint,
          keys: subObj.keys,
        }),
      });

      if (subRes.ok) {
        statusEl.textContent = 'Successfully subscribed to Scout leads!';
      } else {
        await sub.unsubscribe().catch(() => {});
        const errJson = await subRes.json().catch(() => ({}));
        statusEl.textContent = `Subscription failed: ${errJson.error || 'Server error'}`;
      }
    } catch (err) {
      statusEl.textContent = `Enable failed: ${err.message}`;
    } finally {
      enableBtn.disabled = false;
      await updateUI();
    }
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    statusEl.textContent = 'Sending test notification...';
    try {
      const sub = await registration.pushManager.getSubscription();
      if (!sub) {
        statusEl.textContent = 'No local subscription found.';
        await updateUI();
        return;
      }
      const testRes = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      const testData = await testRes.json();
      if (testRes.ok && testData.ok) {
        statusEl.textContent = 'Test notification dispatched!';
      } else {
        statusEl.textContent = `Test failed: ${testData.error || 'Unknown error'}`;
      }
    } catch (err) {
      statusEl.textContent = `Test failed: ${err.message}`;
    } finally {
      testBtn.disabled = false;
    }
  });

  savePreferencesBtn.addEventListener('click', async () => {
    savePreferencesBtn.disabled = true;
    statusEl.textContent = 'Saving notification preferences...';
    try {
      const sub = await registration.pushManager.getSubscription();
      if (!sub) {
        statusEl.textContent = 'No local subscription found.';
        await updateUI();
        return;
      }
      const prefRes = await fetch('/api/push/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          scout_enabled: scoutPref.checked,
          today_enabled: todayPref.checked,
          quiet_hours_enabled: quietPref.checked,
          quiet_start: quietStart.value,
          quiet_end: quietEnd.value,
        }),
      });
      const prefData = await prefRes.json();
      if (!prefRes.ok || !prefData.ok) {
        throw new Error(prefData.error || 'Server error');
      }
      statusEl.textContent = 'Notification preferences saved.';
    } catch (err) {
      statusEl.textContent = `Save failed: ${err.message}`;
    } finally {
      savePreferencesBtn.disabled = false;
    }
  });

  disableBtn.addEventListener('click', async () => {
    disableBtn.disabled = true;
    statusEl.textContent = 'Disabling notifications...';
    try {
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      statusEl.textContent = 'Notifications disabled.';
    } catch (err) {
      statusEl.textContent = `Disable failed: ${err.message}`;
    } finally {
      disableBtn.disabled = false;
      await updateUI();
    }
  });

  await updateUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScoutPush);
} else {
  initScoutPush();
}
