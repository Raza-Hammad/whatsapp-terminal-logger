/**
 * WhatsApp Web Terminal Logger - Content Script Bridge
 * Injects Engine A (injected.js) into the MAIN world and relays
 * messages bidirectionally between the page context and background.js.
 */

(function () {
  'use strict';

  console.log('[WA Terminal Logger] Bridge content script initialized.');

  let isEnabled = true;
  let autoReplyEnabled = true;

  // 1. Initialize enabled and auto-reply states from storage
  chrome.storage.local.get(['isEnabled', 'autoReplyEnabled'], (res) => {
    isEnabled = res.isEnabled !== false;
    autoReplyEnabled = res.autoReplyEnabled !== false;
    console.log(`[WA Terminal Logger] Initial status: Logger=${isEnabled ? 'ENABLED' : 'PAUSED'}, AutoReply=${autoReplyEnabled ? 'ENABLED' : 'PAUSED'}`);
    window.postMessage({ source: 'WA_LOGGER_CONTROL', isEnabled, autoReplyEnabled }, '*');
  });

  // 2. Listen for incoming messages from background.js / popup.js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    if (msg.type === 'TOGGLE_STATE') {
      if (msg.isEnabled !== undefined) isEnabled = Boolean(msg.isEnabled);
      if (msg.autoReplyEnabled !== undefined) autoReplyEnabled = Boolean(msg.autoReplyEnabled);

      console.log(`[WA Terminal Logger] Control update: Logger=${isEnabled ? 'ENABLED' : 'PAUSED'}, AutoReply=${autoReplyEnabled ? 'ENABLED' : 'PAUSED'}`);

      // Forward control states to injected.js in MAIN world
      window.postMessage({ source: 'WA_LOGGER_CONTROL', isEnabled, autoReplyEnabled }, '*');
      sendResponse({ received: true, isEnabled, autoReplyEnabled });
      return;
    }

    // AI reply bubbles received from backend (via background.js)
    if (msg.type === 'WA_LOGGER_AI_RESPONSE') {
      window.postMessage({ source: 'WA_LOGGER_AI_RESPONSE', ...(msg.data || {}) }, '*');
      sendResponse({ forwarded: true });
      return;
    }

    // Historical chat request from dashboard (via background.js)
    if (msg.type === 'WA_LOGGER_FETCH_HISTORY') {
      window.postMessage({ source: 'WA_LOGGER_FETCH_HISTORY', ...(msg.data || {}) }, '*');
      sendResponse({ forwarded: true });
      return;
    }
  });

  // 3. Inject Engine A (injected.js) into the page's MAIN context
  function injectMainScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.type = 'text/javascript';
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
      console.log('[WA Terminal Logger] Injected Engine A (injected.js) into page.');
    } catch (err) {
      console.warn('[WA Terminal Logger] Error injecting script:', err);
    }
  }

  injectMainScript();

  // 4. Relay messages from injected.js (MAIN world) to background.js
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.source === 'WA_LOGGER_INTERNAL_READY') {
      console.log(`[WA Terminal Logger] Engine A ready via: ${event.data.method}`);
      // Re-send current control state in case injected.js just finished initial hook
      window.postMessage({ source: 'WA_LOGGER_CONTROL', isEnabled, autoReplyEnabled }, '*');
      return;
    }

    // Standard message logging (groups or 1-on-1 without auto-reply)
    if (event.data.source === 'WA_LOGGER_INTERNAL' && event.data.payload) {
      if (!isEnabled) return;

      chrome.runtime.sendMessage({
        type: 'NEW_WA_MESSAGE',
        payload: event.data.payload
      });
      return;
    }

    // AI Auto-Reply burst payload for backend Gemini generation
    if (event.data.source === 'WA_LOGGER_AI_REQUEST' && event.data.payload) {
      if (!isEnabled || !autoReplyEnabled) return;

      chrome.runtime.sendMessage({
        type: 'WA_LOGGER_AI_REQUEST',
        payload: event.data.payload
      });
      return;
    }

    // Contact synchronization for Localhost Dashboard
    if (event.data.source === 'WA_LOGGER_SYNC_CONTACTS' && event.data.contacts) {
      chrome.runtime.sendMessage({
        type: 'WA_LOGGER_SYNC_CONTACTS',
        contacts: event.data.contacts
      });
      return;
    }

    // Historical messages result for Localhost Dashboard
    if (event.data.source === 'WA_LOGGER_HISTORY_RESULT') {
      chrome.runtime.sendMessage({
        type: 'WA_LOGGER_HISTORY_RESULT',
        data: event.data
      });
      return;
    }
  });
})();
