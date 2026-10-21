/**
 * WhatsApp Web Terminal Logger - Background Service Worker
 * Handles extension lifecycle, relays message payloads to the local logging server,
 * proxies AI replies, syncs contacts, and polls dashboard command queue.
 */

const SERVER_BASE = 'http://localhost:3000';
const LOG_URL = `${SERVER_BASE}/log-message`;
const AI_REPLY_URL = `${SERVER_BASE}/ai-reply`;
const SYNC_CONTACTS_URL = `${SERVER_BASE}/api/sync-contacts`;
const COMMAND_RESULT_URL = `${SERVER_BASE}/api/command-result`;
const POLL_COMMANDS_URL = `${SERVER_BASE}/api/poll-commands`;

// 1. Initialize extension storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['isEnabled', 'autoReplyEnabled'], (result) => {
    const updates = {};
    if (result.isEnabled === undefined) {
      updates.isEnabled = true;
    }
    if (result.autoReplyEnabled === undefined) {
      updates.autoReplyEnabled = true;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates, () => {
        console.log('[WA Logger SW] Extension installed & defaults set (isEnabled: true, autoReplyEnabled: true).');
      });
    }
  });
});

// 2. Message router for events from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  // A. Standard Terminal Logging (Group or 1-on-1)
  if (message.type === 'NEW_WA_MESSAGE') {
    chrome.storage.local.get(['isEnabled'], async (result) => {
      const isEnabled = result.isEnabled !== false;
      if (!isEnabled) {
        sendResponse({ success: false, reason: 'disabled' });
        return;
      }

      try {
        const response = await fetch(LOG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message.payload || {})
        });

        if (!response.ok) {
          sendResponse({ success: false, status: response.status });
          return;
        }

        const data = await response.json().catch(() => ({}));
        sendResponse({ success: true, data });
      } catch (err) {
        console.warn('[WA Logger SW] Failed to reach logging server at /log-message:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  // B. AI Auto-Reply Burst Request
  if (message.type === 'WA_LOGGER_AI_REQUEST') {
    chrome.storage.local.get(['isEnabled', 'autoReplyEnabled'], async (result) => {
      const isEnabled = result.isEnabled !== false;
      const autoReplyEnabled = result.autoReplyEnabled !== false;

      if (!isEnabled || !autoReplyEnabled) {
        sendResponse({ success: false, reason: 'auto_reply_disabled' });
        return;
      }

      try {
        console.log(`[WA Logger SW] Requesting Gemini AI reply for ${message.payload?.senderName || message.payload?.chatId}...`);

        // Safety net only: allow the server/model to finish. The server has its
        // own 15s ceiling, so this sits just above it.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 18000);

        let response;
        try {
          response = await fetch(AI_REPLY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.payload || {}),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          console.warn(`[WA Logger SW] /ai-reply responded with HTTP ${response.status}`);
          sendResponse({ success: false, status: response.status });
          return;
        }

        const data = await response.json();
        const replies = Array.isArray(data.replies) ? data.replies : [];

        // Forward generated bubbles back to the WhatsApp tab's content.js
        const tabId = sender.tab?.id;
        if (tabId && replies.length > 0) {
          chrome.tabs.sendMessage(tabId, {
            type: 'WA_LOGGER_AI_RESPONSE',
            data: {
              chatId: message.payload.chatId,
              replies
            }
          });
        }

        sendResponse({ success: true, repliesCount: replies.length });
      } catch (err) {
        if (err.name === 'AbortError') {
          console.warn('[WA Logger SW] /ai-reply timed out (18s safety limit reached).');
          sendResponse({ success: false, error: 'timeout' });
          return;
        }
        console.warn('[WA Logger SW] Error calling /ai-reply:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  // C. Sync 1-on-1 Contacts from WhatsApp Web to Localhost Dashboard
  if (message.type === 'WA_LOGGER_SYNC_CONTACTS') {
    fetch(SYNC_CONTACTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: message.contacts || [] })
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // D. Historical Chat Result for Localhost Dashboard
  if (message.type === 'WA_LOGGER_HISTORY_RESULT') {
    fetch(COMMAND_RESULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.data || {})
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// 3. Poll Localhost Dashboard Command Queue (every 1.5s)
let isPolling = false;

async function pollDashboardCommands() {
  if (isPolling) return;
  isPolling = true;

  try {
    const res = await fetch(POLL_COMMANDS_URL);
    if (res.ok) {
      const data = await res.json();
      if (data?.command) {
        console.log('[WA Logger SW] Received dashboard command:', data.command.type, data.command.requestId);

        // Forward to open WhatsApp Web tab
        chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, (tabs) => {
          if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'WA_LOGGER_FETCH_HISTORY',
              data: data.command
            });
          }
        });
      }
    }
  } catch (e) {
    // Server offline or sleeping; ignore
  } finally {
    isPolling = false;
  }
}

setInterval(pollDashboardCommands, 1500);
