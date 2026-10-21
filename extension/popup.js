/**
 * WhatsApp Web Terminal Logger - Popup Controller
 */

const HEALTH_URL = 'http://localhost:3000/health';

document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('serverStatus');
  const statusText = document.getElementById('statusText');
  const loggerToggle = document.getElementById('loggerToggle');
  const autoReplyToggle = document.getElementById('autoReplyToggle');
  const toggleSubtitle = document.getElementById('toggleSubtitle');
  const autoReplySubtitle = document.getElementById('autoReplySubtitle');

  // 1. Check Server Connection Status via GET http://localhost:3000/health
  checkServerHealth();

  function checkServerHealth() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    fetch(HEALTH_URL, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timeoutId);
        if (res.ok) {
          statusBadge.className = 'status-badge online';
          statusText.textContent = 'Server: Online';
        } else {
          throw new Error('Non-200 response');
        }
      })
      .catch(() => {
        clearTimeout(timeoutId);
        statusBadge.className = 'status-badge offline';
        statusText.textContent = 'Server: Offline';
      });
  }

  // 2. Load stored states from chrome.storage.local
  chrome.storage.local.get(['isEnabled', 'autoReplyEnabled'], (result) => {
    const isEnabled = result.isEnabled !== false; // Default true
    const autoReplyEnabled = result.autoReplyEnabled !== false; // Default true

    loggerToggle.checked = isEnabled;
    autoReplyToggle.checked = autoReplyEnabled;

    updateLoggerSubtitle(isEnabled);
    updateAutoReplySubtitle(autoReplyEnabled);
  });

  // 3. Handle Logger Toggle Change
  loggerToggle.addEventListener('change', () => {
    const isEnabled = loggerToggle.checked;
    const autoReplyEnabled = autoReplyToggle.checked;
    updateLoggerSubtitle(isEnabled);

    chrome.storage.local.set({ isEnabled }, () => {
      broadcastToggleState(isEnabled, autoReplyEnabled);
    });
  });

  // 4. Handle Auto-Reply Toggle Change
  autoReplyToggle.addEventListener('change', () => {
    const isEnabled = loggerToggle.checked;
    const autoReplyEnabled = autoReplyToggle.checked;
    updateAutoReplySubtitle(autoReplyEnabled);

    chrome.storage.local.set({ autoReplyEnabled }, () => {
      broadcastToggleState(isEnabled, autoReplyEnabled);
    });
  });

  function updateLoggerSubtitle(isEnabled) {
    toggleSubtitle.textContent = isEnabled ? 'Streaming enabled' : 'Streaming paused';
  }

  function updateAutoReplySubtitle(autoReplyEnabled) {
    autoReplySubtitle.textContent = autoReplyEnabled
      ? 'John persona • 7s burst wait'
      : 'Auto-reply disabled';
  }

  function broadcastToggleState(isEnabled, autoReplyEnabled) {
    const payload = { type: 'TOGGLE_STATE', isEnabled, autoReplyEnabled };

    // Broadcast to active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id && activeTab.url?.includes('web.whatsapp.com')) {
        chrome.tabs.sendMessage(activeTab.id, payload, () => {
          if (chrome.runtime.lastError) {
            // Ignore if script not ready
          }
        });
      }
    });

    // Also broadcast to all WhatsApp Web tabs
    chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, (waTabs) => {
      waTabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, payload, () => {
          if (chrome.runtime.lastError) {
            // Ignore if script not ready
          }
        });
      });
    });
  }
});
