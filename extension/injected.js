/**
 * WhatsApp Web Terminal Logger - Injected Script (Engine A: Store Hook)
 * Hooks directly into WhatsApp Web's internal WAWebMsgCollection for 100% accurate,
 * real-time message capture, AI Human Persona burst auto-replying, 1-on-1 contact syncing,
 * and on-demand historical message retrieval for the localhost dashboard.
 */

(function () {
  'use strict';

  console.log('[WA Logger Internal] Injected script started in MAIN world.');

  let isHooked = false;
  let isEnabled = true;
  let autoReplyEnabled = true;
  let attempts = 0;
  const MAX_ATTEMPTS = 60;

  // Real-time cutoff timestamp in seconds (strict cutoff for ignoring historical messages)
  let activationTimeSec = Math.floor(Date.now() / 1000);
  const seenMsgIds = new Set();
  const sentByAiTexts = new Set(); // Prevents self-reply loops

  // 7-second burst buffering map: chatId -> { timer, messages: [], chatObj, lastMsg, meta }
  const dmBurstBuffers = new Map();
  const lastReceivedMsgMap = new Map(); // chatId -> last incoming msg
  const lastMessageAtByChat = new Map(); // chatId -> Date.now() of last incoming msg
  const aiRequestStartedAt = new Map(); // chatId -> Date.now() when AI request was dispatched

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function formatTime(unixSec) {
    if (!unixSec) return new Date().toLocaleTimeString();
    return new Date(unixSec * 1000).toLocaleTimeString();
  }

  function formatPhoneNumber(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let cleaned = raw.replace(/@(c\.us|s\.whatsapp\.net|g\.us|lid|newsletter|broadcast)$/i, '').trim();
    if (!cleaned) return '';
    if (cleaned.startsWith('+')) return cleaned;
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 16) {
      return '+' + digits;
    }
    return cleaned;
  }

  const ALLOWED_MSG_TYPES = new Set([
    'chat',
    'image',
    'video',
    'audio',
    'ptt',
    'document',
    'sticker',
    'location',
    'vcard'
  ]);

  const MAX_MEDIA_BYTES = 15 * 1024 * 1024; // 15 MB
  const SUPPORTED_MEDIA_TYPES = new Set(['image', 'sticker', 'document', 'ptt', 'audio']);

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        if (typeof res === 'string') {
          const commaIdx = res.indexOf(',');
          resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
        } else {
          resolve(null);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function bufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function formatMediaDisplayText(m) {
    if (!m) return '';
    const type = m.type || 'chat';
    const caption = (m.caption || '').trim();
    const filename = m.filename || '';

    if (type === 'chat') {
      return (m.body || '').trim();
    }
    if (type === 'document') {
      return caption ? `📄 [Document: ${filename || 'File'}] ${caption}` : `📄 [Document: ${filename || 'File'}]`;
    }
    if (type === 'image') {
      return caption ? `🖼️ [Image] ${caption}` : `🖼️ [Image]`;
    }
    if (type === 'ptt') {
      const dur = m.duration ? ` • ${m.duration}s` : '';
      return `🎤 [Voice Message${dur}]`;
    }
    if (type === 'audio') {
      return `🎵 [Audio${filename ? ': ' + filename : ''}]`;
    }
    if (type === 'video') {
      return caption ? `🎬 [Video] ${caption}` : `🎬 [Video]`;
    }
    if (type === 'sticker') {
      return '🏷️ [Sticker]';
    }
    return caption || (filename ? `[File: ${filename}]` : `[${type.toUpperCase()}]`);
  }

  const THUMBNAIL_MSG_TYPES = new Set(['image', 'video', 'document', 'sticker']);

  function isBase64Thumbnail(value) {
    if (typeof value !== 'string') return false;
    const cleaned = value.trim();
    return cleaned.startsWith('/9j/') ||
           cleaned.startsWith('iVBOR') ||
           cleaned.startsWith('R0lGOD') ||
           cleaned.startsWith('UklGR') ||
           cleaned.startsWith('data:image/');
  }

  function extractThumbnailBase64(m) {
    if (!m || !THUMBNAIL_MSG_TYPES.has(m.type)) return null;
    if (!isBase64Thumbnail(m.body)) return null;
    return m.body.replace(/^data:image\/[^;]+;base64,/i, '').trim();
  }

  function detectImageMimeFromBase64(base64) {
    if (!base64 || typeof base64 !== 'string') return 'image/jpeg';
    if (base64.startsWith('/9j/')) return 'image/jpeg';
    if (base64.startsWith('iVBOR')) return 'image/png';
    if (base64.startsWith('UklGR')) return 'image/webp';
    if (base64.startsWith('R0lGOD')) return 'image/gif';
    // ISO-BMFF (HEIC/HEIF) base64 usually carries 'ftyp' a few bytes in.
    if (base64.slice(0, 40).includes('ZnR5c')) return 'image/heic';
    return 'image/jpeg';
  }

  const MIME_BY_EXTENSION = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
    pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword', xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv', json: 'application/json',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/opus', m4a: 'audio/m4a',
    wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
  };

  function inferMimeFromFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') return '';
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    return MIME_BY_EXTENSION[ext] || '';
  }

  function getPreviewBlob(msg) {
    const preview = msg?.mediaData?.preview || msg?.mediaObject?.preview;
    if (!preview) return null;
    if (preview instanceof Blob) return preview;
    if (preview._blob instanceof Blob) return preview._blob;
    if (preview.blob instanceof Blob) return preview.blob;
    return null;
  }

  /**
   * In-Memory Media Decryption & Base64 Extraction Helper
   * Handles Images, Stickers, Documents (PDF), Voice Notes (PTT), and Audio
   */
  async function extractMessageMedia(msg) {
    if (!msg || !SUPPORTED_MEDIA_TYPES.has(msg.type)) return null;

    const fileSize = msg.size || msg.fileSize || msg.mediaData?.size || 0;

    // 15 MB File Size Guard
    if (fileSize > MAX_MEDIA_BYTES) {
      console.log(`[WA Logger Internal] Skipping media download: file size (${Math.round(fileSize / (1024 * 1024))} MB) exceeds 15 MB guard.`);
      const thumbnailBase64 = extractThumbnailBase64(msg);
      const thumbnailMime = detectImageMimeFromBase64(thumbnailBase64);
      return {
        hasMedia: true,
        skippedLargeFile: true,
        mediaType: msg.type,
        fileName: msg.filename || `${msg.type}_${msg.t || Date.now()}`,
        mimeType: msg.mimetype || '',
        fileSize,
        caption: msg.caption || '',
        thumbnailBase64,
        previewUrl: thumbnailBase64 ? `data:${thumbnailMime};base64,${thumbnailBase64}` : null,
        base64Data: null
      };
    }

    console.log(`[WA Logger Internal] Downloading media (${msg.type}, ${msg.mimetype || 'unknown'}, ${Math.round(fileSize / 1024)} KB)...`);

    let cleanMimeType = '';
    if (msg.mimetype) {
      cleanMimeType = msg.mimetype.split(';')[0].trim().toLowerCase();
    }
    if (!cleanMimeType || cleanMimeType === 'application/octet-stream') {
      // WhatsApp sometimes omits mimetype entirely. Infer it from the filename
      // first so an image sent as a document is not mistaken for a PDF.
      const inferredMime = inferMimeFromFileName(msg.filename);
      if (inferredMime) cleanMimeType = inferredMime;
      else if (msg.type === 'ptt') cleanMimeType = 'audio/ogg';
      else if (msg.type === 'audio') cleanMimeType = 'audio/mpeg';
      else if (msg.type === 'image') cleanMimeType = 'image/jpeg';
      else if (msg.type === 'sticker') cleanMimeType = 'image/webp';
      else if (msg.type === 'document') cleanMimeType = 'application/pdf';
      else cleanMimeType = 'application/octet-stream';
    }

    let rawBlobOrBuffer = null;
    let rawBase64String = null;
    let downloadedMimeType = '';

    // Convert OpaqueData / wrapper objects into something we can read.
    function unwrapMediaBlob(value) {
      if (!value) return null;
      if (value instanceof Blob ||
          value instanceof ArrayBuffer ||
          ArrayBuffer.isView(value) ||
          typeof value === 'string') {
        return value;
      }
      if (typeof value.forceToBlob === 'function') {
        try {
          const blob = value.forceToBlob();
          if (blob && typeof blob.then === 'function') return blob;
          if (blob instanceof Blob) return blob;
        } catch (_) {}
      }
      if (value._blob instanceof Blob) return value._blob;
      if (value.blob instanceof Blob) return value.blob;
      if (value.mediaBlob instanceof Blob) return value.mediaBlob;
      if (typeof value.blob === 'function') {
        try {
          const blob = value.blob();
          if (blob && (blob instanceof Blob || typeof blob.then === 'function')) return blob;
        } catch (_) {}
      }
      if (value.data instanceof Blob || typeof value.data === 'string') return value.data;
      return null;
    }

    function readFromBlobCache() {
      try {
        const cache = window.require?.('WAWebMediaInMemoryBlobCache')?.InMemoryMediaBlobCache;
        const cached = cache?.get?.(msg.mediaObject?.filehash);
        return unwrapMediaBlob(cached);
      } catch (_) {
        return null;
      }
    }

    function readFromMessage() {
      return unwrapMediaBlob(msg.mediaObject?.mediaBlob) ||
             unwrapMediaBlob(msg.mediaData?.mediaBlob) ||
             unwrapMediaBlob(msg.mediaObject?._mediaBlob) ||
             unwrapMediaBlob(msg.mediaObject) ||
             null;
    }

    try {
      // Mirror whatsapp-web.js resolveMediaBlob: await msg.downloadMedia with
      // isUserInitiated: true, then read the blob from InMemoryMediaBlobCache
      // or from msg.mediaObject.mediaBlob.forceToBlob().
      if (typeof msg.downloadMedia === 'function') {
        try {
          const downloadPromise = msg.downloadMedia({
            downloadEvenIfExpensive: true,
            rmrReason: 1,
            isUserInitiated: true
          });

          if (downloadPromise && typeof downloadPromise.then === 'function') {
            const result = await Promise.race([
              downloadPromise.catch((err) => {
                console.warn('[WA Logger Internal] downloadMedia rejected:', err?.message || err);
                return null;
              }),
              sleep(6000).then(() => null)
            ]);
            if (result) rawBlobOrBuffer = unwrapMediaBlob(result) || result;
          } else if (downloadPromise) {
            rawBlobOrBuffer = unwrapMediaBlob(downloadPromise) || downloadPromise;
          }
        } catch (downloadErr) {
          console.warn('[WA Logger Internal] downloadMedia threw:', downloadErr?.message || downloadErr);
          try {
            const legacy = await msg.downloadMedia(true, 1);
            if (legacy) rawBlobOrBuffer = unwrapMediaBlob(legacy) || legacy;
          } catch (_) {}
        }
      }

      // The awaited call can still leave mediaStage as FETCHING briefly.
      let mediaPoll = 0;
      while (!rawBlobOrBuffer && mediaPoll < 10) {
        rawBlobOrBuffer = readFromBlobCache() || readFromMessage();
        if (rawBlobOrBuffer) break;

        const stage = msg.mediaData?.mediaStage || '';
        if (stage.includes('ERROR')) {
          console.warn(`[WA Logger Internal] Media download error stage: ${stage}`);
          break;
        }

        await sleep(200);
        mediaPoll++;
      }

      // Resolve any thenable blob accessor before reading bytes.
      if (rawBlobOrBuffer && typeof rawBlobOrBuffer.then === 'function') {
        try { rawBlobOrBuffer = await rawBlobOrBuffer; } catch (_) { rawBlobOrBuffer = null; }
        rawBlobOrBuffer = unwrapMediaBlob(rawBlobOrBuffer) || rawBlobOrBuffer;
      }

      if (rawBlobOrBuffer && !(rawBlobOrBuffer instanceof Blob) &&
          !(rawBlobOrBuffer instanceof ArrayBuffer) &&
          !ArrayBuffer.isView(rawBlobOrBuffer) &&
          typeof rawBlobOrBuffer !== 'string') {
        rawBlobOrBuffer = unwrapMediaBlob(rawBlobOrBuffer);
      }

      // Last resort: a blob:/data: URL exposed by the media wrapper.
      if (!rawBlobOrBuffer) {
        const mb = msg.mediaObject?.mediaBlob || msg.mediaData?.mediaBlob;
        const blobUrl = (typeof mb?.url === 'function' ? mb.url() : null) ||
                        (typeof mb?.getUrl === 'function' ? mb.getUrl() : null) ||
                        mb?.blobUrl || mb?._blobUrl;
        if (typeof blobUrl === 'string' && (blobUrl.startsWith('blob:') || blobUrl.startsWith('data:'))) {
          try {
            const resp = await fetch(blobUrl);
            if (resp.ok) rawBlobOrBuffer = await resp.blob();
          } catch (fetchErr) {
            console.warn('[WA Logger Internal] Error fetching media blobUrl:', fetchErr);
          }
        }
      }

      if (rawBlobOrBuffer) {
        const blobInfo = rawBlobOrBuffer instanceof Blob
          ? `Blob ${rawBlobOrBuffer.size} bytes (${rawBlobOrBuffer.type || 'no type'})`
          : (rawBlobOrBuffer.constructor?.name || typeof rawBlobOrBuffer);
        console.log(`[WA Logger Internal] Media blob ready for ${msg.type}: ${blobInfo}`);
      } else {
        console.warn(`[WA Logger Internal] No media blob resolved for ${msg.type} (stage: ${msg.mediaData?.mediaStage || 'unknown'})`);
      }

      // Check 5: convert the resolved blob/buffer into raw base64.
      if (rawBlobOrBuffer) {
        if (rawBlobOrBuffer instanceof Blob) {
          if (rawBlobOrBuffer.type && rawBlobOrBuffer.type !== 'application/octet-stream') {
            downloadedMimeType = rawBlobOrBuffer.type.split(';')[0].trim().toLowerCase();
          }
          rawBase64String = await blobToBase64(rawBlobOrBuffer);
        } else if (rawBlobOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(rawBlobOrBuffer)) {
          rawBase64String = bufferToBase64(rawBlobOrBuffer);
        } else if (typeof rawBlobOrBuffer === 'string') {
          if (rawBlobOrBuffer.startsWith('blob:')) {
            try {
              const resp = await fetch(rawBlobOrBuffer);
              if (resp.ok) {
                const blob = await resp.blob();
                if (blob.type && blob.type !== 'application/octet-stream') {
                  downloadedMimeType = blob.type.split(';')[0].trim().toLowerCase();
                }
                rawBase64String = await blobToBase64(blob);
              }
            } catch (fetchErr) {
              console.warn('[WA Logger Internal] Error fetching blob string:', fetchErr);
            }
          } else {
            const commaIdx = rawBlobOrBuffer.indexOf(',');
            rawBase64String = commaIdx !== -1 ? rawBlobOrBuffer.slice(commaIdx + 1) : rawBlobOrBuffer;
          }
        }
      }

      // Prefer a real preview blob over msg.body when available.
      let thumbnailBase64 = extractThumbnailBase64(msg);
      if (!thumbnailBase64) {
        const previewBlob = getPreviewBlob(msg);
        if (previewBlob) {
          try { thumbnailBase64 = await blobToBase64(previewBlob); } catch (_) {}
        }
      }

      const isImageLike = msg.type === 'image' || msg.type === 'sticker';
      // An image sent as a document is still an image; its thumbnail is valid
      // low-resolution content Gemini can analyze if the full download fails.
      const isImageDocument = msg.type === 'document' && cleanMimeType.startsWith('image/');
      const showsAsImage = isImageLike || isImageDocument;

      // For images/stickers a thumbnail is still a valid image Gemini can see.
      // For non-image documents/videos the thumbnail is only a visual preview.
      let base64Data = rawBase64String;
      let resolvedMimeType = downloadedMimeType || cleanMimeType;

      if (!base64Data && showsAsImage && thumbnailBase64) {
        base64Data = thumbnailBase64;
        resolvedMimeType = detectImageMimeFromBase64(thumbnailBase64);
        console.log(`[WA Logger Internal] Used thumbnail fallback for ${msg.type} (${resolvedMimeType}).`);
      }

      // Keep audio MIME usable even when WhatsApp reports octet-stream.
      if ((msg.type === 'ptt' || msg.type === 'audio') && !resolvedMimeType.startsWith('audio/')) {
        resolvedMimeType = msg.type === 'ptt' ? 'audio/ogg' : 'audio/mpeg';
      }

      const previewBase64 = rawBase64String && showsAsImage ? rawBase64String : thumbnailBase64;
      const previewMimeType = rawBase64String && showsAsImage
        ? (downloadedMimeType || cleanMimeType)
        : detectImageMimeFromBase64(thumbnailBase64);

      const ok = Boolean(base64Data || thumbnailBase64);
      console.log(`[WA Logger Internal] Media extracted for ${msg.type}: ${ok ? (Math.round((base64Data || thumbnailBase64).length * 0.75 / 1024) + ' KB Base64 OK') : 'FAILED (using fallback)'}`);

      return {
        hasMedia: true,
        mediaType: msg.type,
        mimeType: resolvedMimeType,
        fileName: msg.filename || `${msg.type}_${msg.t || Date.now()}`,
        fileSize: fileSize || (base64Data ? Math.round(base64Data.length * 0.75) : 0),
        caption: msg.caption || '',
        base64Data: base64Data || null,
        thumbnailBase64: thumbnailBase64 || null,
        isThumbnailFallback: Boolean(!rawBase64String && previewBase64),
        previewUrl: previewBase64 ? `data:${previewMimeType};base64,${previewBase64}` : null
      };
    } catch (err) {
      console.warn(`[WA Logger Internal] extractMessageMedia error for ${msg.type}:`, err);
      const thumbnailBase64 = extractThumbnailBase64(msg);
      const thumbnailMime = detectImageMimeFromBase64(thumbnailBase64);
      return {
        hasMedia: true,
        mediaType: msg.type,
        mimeType: cleanMimeType,
        fileName: msg.filename || `${msg.type}_${msg.t || Date.now()}`,
        fileSize,
        caption: msg.caption || '',
        base64Data: null,
        thumbnailBase64: thumbnailBase64 || null,
        previewUrl: thumbnailBase64 ? `data:${thumbnailMime};base64,${thumbnailBase64}` : null
      };
    }
  }



  // =========================================================================
  // Control & Command Event Listeners
  // =========================================================================

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data) return;

    // 1. Popup Toggle / State updates
    if (event.data.source === 'WA_LOGGER_CONTROL' || event.data.type === 'WA_LOGGER_TOGGLE') {
      if (event.data.isEnabled !== undefined) {
        const wasEnabled = isEnabled;
        isEnabled = Boolean(event.data.isEnabled);
        if (isEnabled && !wasEnabled) {
          activationTimeSec = Math.floor(Date.now() / 1000);
          console.log(`[WA Logger Internal] Logger RE-ENABLED. Fresh activation cutoff: ${activationTimeSec} (${new Date().toLocaleTimeString()}).`);
        } else if (!isEnabled) {
          console.log('[WA Logger Internal] Logger PAUSED.');
        }
      }

      if (event.data.autoReplyEnabled !== undefined) {
        autoReplyEnabled = Boolean(event.data.autoReplyEnabled);
        console.log(`[WA Logger Internal] Auto-Reply (DMs) is now: ${autoReplyEnabled ? 'ENABLED (7s burst)' : 'PAUSED'}.`);
      }
      return;
    }

    // 2. Multi-Bubble AI Reply received from background.js
    if (event.data.source === 'WA_LOGGER_AI_RESPONSE') {
      handleAiResponse(event.data);
      return;
    }

    // 3. On-demand Historical Chat extraction from dashboard
    if (event.data.source === 'WA_LOGGER_FETCH_HISTORY') {
      handleFetchHistory(event.data);
      return;
    }
  });

  // =========================================================================
  // Contact & Detail Resolution Helper
  // =========================================================================

  function resolveContactDetails(chat) {
    const chatId = chat?.id?._serialized || String(chat?.id || '');
    let ContactCollection = null;
    if (typeof window.require === 'function') {
      try {
        ContactCollection = window.require('WAWebContactCollection')?.ContactCollection;
      } catch (e) {}
    }

    const contact = chat?.contact || (chatId && ContactCollection?.get ? ContactCollection.get(chatId) : null);

    let resolvedPhone = '';
    if (chatId.endsWith('@lid')) {
      const phoneFromObj = contact?.phoneNumber?._serialized || contact?.id?.user;
      if (phoneFromObj && !String(phoneFromObj).includes('_')) {
        resolvedPhone = formatPhoneNumber(String(phoneFromObj));
      }
    } else {
      resolvedPhone = formatPhoneNumber(chatId);
    }

    if (!resolvedPhone && contact?.id?.user) {
      resolvedPhone = formatPhoneNumber(String(contact.id.user));
    }

    const isAddressBook = contact?.isAddressBookContact === true || Boolean(contact?.name);
    const savedName = (isAddressBook && (contact?.name || contact?.shortName)) || null;
    const isSaved = Boolean(savedName);
    const name = savedName || contact?.pushname || chat?.formattedTitle || chat?.name || resolvedPhone || 'Unknown';
    const number = resolvedPhone || (contact?.id?.user ? formatPhoneNumber(contact.id.user) : chatId);

    return { chatId, name, number, isSaved, contact };
  }

  // =========================================================================
  // Contact Synchronization for Dashboard
  // =========================================================================

  let lastSyncTime = 0;

  function syncOneOnOneContacts() {
    const now = Date.now();
    if (now - lastSyncTime < 2000) return; // Minimum 2s throttle
    lastSyncTime = now;

    try {
      const ChatMod = window.require ? window.require('WAWebChatCollection') : null;
      const chatCollection = ChatMod?.ChatCollection || ChatMod?.default || ChatMod;
      if (!chatCollection || typeof chatCollection.getModelsArray !== 'function') return;

      const allChats = chatCollection.getModelsArray();
      const contacts = [];

      for (const chat of allChats) {
        if (!chat) continue;
        const cid = chat.id?._serialized || String(chat.id || '');
        if (
          chat.isGroup ||
          chat.isNewsletter ||
          cid.endsWith('@g.us') ||
          cid.endsWith('@newsletter') ||
          cid.endsWith('@broadcast') ||
          cid === 'status@broadcast'
        ) {
          continue;
        }

        const { chatId, name, number, isSaved } = resolveContactDetails(chat);
        contacts.push({
          chatId,
          name,
          number,
          isSaved,
          lastMsgTime: chat.t || 0,
          unreadCount: chat.unreadCount || 0
        });
      }

      // Sort recent chats first
      contacts.sort((a, b) => (b.lastMsgTime || 0) - (a.lastMsgTime || 0));

      window.postMessage({
        source: 'WA_LOGGER_SYNC_CONTACTS',
        contacts
      }, '*');
    } catch (err) {
      console.warn('[WA Logger Internal] Error in syncOneOnOneContacts:', err);
    }
  }

  // =========================================================================
  // On-Demand History Extraction (WA_LOGGER_FETCH_HISTORY)
  // =========================================================================

  const MAX_DASHBOARD_MEDIA_BYTES = 2 * 1024 * 1024; // 2 MB

  function getResolvedMediaBlob(msg) {
    // Only the full decrypted media blob is used for mediaUrl. Thumbnails are
    // handled separately through msg.body/preview to avoid linking a preview
    // image as if it were the real document.
    let cached = null;
    try {
      cached = window.require?.('WAWebMediaInMemoryBlobCache')
        ?.InMemoryMediaBlobCache?.get?.(msg?.mediaObject?.filehash);
    } catch (_) {}

    const candidates = [
      cached,
      msg?.mediaObject?.mediaBlob,
      msg?.mediaData?.mediaBlob,
      msg?.mediaObject?._mediaBlob
    ];

    for (const value of candidates) {
      if (!value) continue;
      if (value instanceof Blob) return value;
      if (typeof value.forceToBlob === 'function') {
        try {
          const blob = value.forceToBlob();
          if (blob instanceof Blob) return blob;
        } catch (_) {}
      }
      if (value._blob instanceof Blob) return value._blob;
      if (value.blob instanceof Blob) return value.blob;
    }

    return null;
  }

  async function resolveMessageMediaDataUrl(msg) {
    try {
      let blob = getResolvedMediaBlob(msg);

      if (!blob) {
        const mb = msg?.mediaData?.mediaBlob;
        const maybeUrl = (typeof mb?.url === 'function' ? mb.url() : null) ||
                         (typeof mb?.getUrl === 'function' ? mb.getUrl() : null) ||
                         mb?.blobUrl ||
                         mb?._blobUrl;

        if (typeof maybeUrl === 'string') {
          if (maybeUrl.startsWith('data:')) return maybeUrl;
          if (maybeUrl.startsWith('blob:')) {
            const resp = await fetch(maybeUrl);
            if (resp.ok) blob = await resp.blob();
          }
        }
      }

      if (!blob || blob.size > MAX_DASHBOARD_MEDIA_BYTES) return null;

      const base64 = await blobToBase64(blob);
      if (!base64) return null;

      const mime = blob.type || msg?.mimetype || 'application/octet-stream';
      return `data:${mime};base64,${base64}`;
    } catch (err) {
      return null;
    }
  }

  async function handleFetchHistory(request) {
    const { requestId, chatId, limit = 50 } = request || {};
    if (!requestId || !chatId) return;

    try {
      const ChatMod = window.require ? window.require('WAWebChatCollection') : null;
      const chatCollection = ChatMod?.ChatCollection || ChatMod?.default || ChatMod;
      const chat = chatCollection?.get ? chatCollection.get(chatId) : null;

      if (!chat) {
        window.postMessage({
          source: 'WA_LOGGER_HISTORY_RESULT',
          requestId,
          chatId,
          success: false,
          error: 'Chat not found in ChatCollection',
          messages: []
        }, '*');
        return;
      }

      const { name: resolvedContactName, number: resolvedNumber, isSaved } = resolveContactDetails(chat);
      const contactInfo = { name: resolvedContactName, number: resolvedNumber, isSaved, chatId };

      // Load earlier messages if requested limit is higher than currently loaded models
      if (chat.msgs && typeof chat.msgs.getModelsArray === 'function') {
        const LoadMsgsMod = window.require ? window.require('WAWebChatLoadMessages') : null;
        const loadEarlierMsgs = LoadMsgsMod?.loadEarlierMsgs || LoadMsgsMod?.default?.loadEarlierMsgs;

        if (typeof loadEarlierMsgs === 'function') {
          let attempts = 0;
          while (attempts < 3) {
            const currentCount = chat.msgs.getModelsArray().length;
            if (currentCount >= limit) break;
            try {
              const p = loadEarlierMsgs(chat);
              if (p && typeof p.then === 'function') {
                await Promise.race([p, sleep(1200)]);
              } else {
                await sleep(400);
              }
            } catch (loadErr) {
              console.warn('[WA Logger Internal] loadEarlierMsgs batch failed:', loadErr);
              break;
            }
            attempts++;
          }
        }
      }

      const rawMsgs = (chat.msgs?.getModelsArray ? chat.msgs.getModelsArray() : [])
        .filter(m => m && ALLOWED_MSG_TYPES.has(m.type) && m.subtype !== 'ciphertext');

      const selected = rawMsgs.slice(-limit);

      const formattedMessages = await Promise.all(selected.map(async (m) => {
        const isFromMe = Boolean(m.id?.fromMe || m.fromMe);
        const type = m.type || 'chat';
        const isMedia = type !== 'chat';
        const formattedText = formatMediaDisplayText(m);
        const t = m.t || Math.floor(Date.now() / 1000);
        const dateObj = new Date(t * 1000);

        // msg.body for image/video/document/sticker is a Base64 preview,
        // never the message text. Only expose it as a visual thumbnail.
        let thumbnailBase64 = extractThumbnailBase64(m);
        if (!thumbnailBase64) {
          const previewBlob = getPreviewBlob(m);
          if (previewBlob) {
            try { thumbnailBase64 = await blobToBase64(previewBlob); } catch (_) {}
          }
        }
        const thumbnailMime = detectImageMimeFromBase64(thumbnailBase64);
        const previewUrl = thumbnailBase64 ? `data:${thumbnailMime};base64,${thumbnailBase64}` : null;

        // Only surface already-resolved, small in-memory media as a data URL.
        // blob: URLs belong to web.whatsapp.com and are unusable on localhost.
        const mediaUrl = isMedia ? await resolveMessageMediaDataUrl(m) : null;

        return {
          id: m.id?._serialized || String(m.t) || Math.random().toString(),
          fromMe: isFromMe,
          senderLabel: isFromMe ? 'Me' : (resolvedContactName || resolvedNumber),
          text: formattedText,
          type: type,
          isMedia: isMedia,
          mediaType: type,
          mimeType: m.mimetype || '',
          fileName: m.filename || '',
          fileSize: m.size || m.fileSize || 0,
          caption: m.caption || '',
          thumbnailBase64: thumbnailBase64 || null,
          previewUrl: previewUrl,
          mediaUrl: mediaUrl,
          duration: m.duration || null,
          timestampUnix: t,
          dateStr: dateObj.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' }),
          timeStr: dateObj.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };
      }));

      window.postMessage({
        source: 'WA_LOGGER_HISTORY_RESULT',
        requestId,
        chatId,
        contactInfo,
        messages: formattedMessages,
        success: true
      }, '*');
    } catch (err) {
      console.warn('[WA Logger Internal] Error in handleFetchHistory:', err);
      window.postMessage({
        source: 'WA_LOGGER_HISTORY_RESULT',
        requestId,
        chatId,
        success: false,
        error: err.message,
        messages: []
      }, '*');
    }
  }

  // =========================================================================
  // DOM Compose Fallback
  // =========================================================================

  async function triggerDomComposeFallback(targetChat, replyText) {
    try {
      console.log('[WA Auto-Reply] Executing DOM Compose Fallback...');

      const CmdMod = window.require ? window.require('WAWebCmd') : null;
      const Cmd = CmdMod?.Cmd || CmdMod?.default || CmdMod;
      if (Cmd?.openChatBottom) {
        Cmd.openChatBottom(targetChat);
      } else if (Cmd?.openChatAt) {
        Cmd.openChatAt({ chat: targetChat });
      }

      await sleep(400);

      const inputBox = document.querySelector('#main footer div[contenteditable="true"]') ||
                       document.querySelector('footer div[contenteditable="true"]') ||
                       document.querySelector('div[contenteditable="true"][data-tab="10"]');

      if (!inputBox) {
        console.warn('[WA Auto-Reply] DOM Fallback: Input box not found in DOM.');
        return false;
      }

      inputBox.focus();
      document.execCommand('insertText', false, replyText);

      await sleep(100);

      const sendBtn = document.querySelector('#main footer button[aria-label="Send"]') ||
                      document.querySelector('#main footer span[data-icon="send"]') ||
                      document.querySelector('#main footer span[data-icon="wds-ic-send-filled"]') ||
                      document.querySelector('button[data-tab="11"]');

      if (sendBtn) {
        const clickable = sendBtn.closest('button') || sendBtn;
        clickable.click();
        console.log('[WA Auto-Reply] Successfully sent via DOM compose button click.');
        return true;
      } else {
        const enterEvt = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          which: 13,
          keyCode: 13,
          bubbles: true
        });
        inputBox.dispatchEvent(enterEvt);
        console.log('[WA Auto-Reply] Successfully sent via DOM Enter keypress.');
        return true;
      }
    } catch (fallbackErr) {
      console.warn('[WA Auto-Reply] DOM Compose Fallback failed:', fallbackErr);
      return false;
    }
  }

  // =========================================================================
  // Background Auto-Reply Send Engine (WAWebMsgKey with Remote)
  // =========================================================================

  async function sendBackgroundAutoReply(chatObj, arg2, arg3, arg4) {
    let targetChat = null;
    let chatId = '';
    let replyText = '';
    let msg = null;

    if (typeof arg2 === 'string' && typeof arg3 === 'string') {
      // (chatObj, chatId, replyText, msg)
      chatId = arg2;
      replyText = arg3;
      msg = arg4 || null;
    } else if (typeof arg2 === 'object' && typeof arg3 === 'string' && typeof arg4 === 'string') {
      // (chatObj, lastMsg, chatId, bubbleText)
      msg = arg2;
      chatId = arg3;
      replyText = arg4;
    } else {
      chatId = String(arg2 || '');
      replyText = String(arg3 || '');
      msg = arg4 || null;
    }

    try {
      // 1. Resolve the Real Chat Model
      const ChatMod = window.require ? window.require('WAWebChatCollection') : null;
      const chatCollection = ChatMod?.ChatCollection || ChatMod?.default || ChatMod;
      targetChat = chatCollection?.get?.(chatId) || chatObj || msg?.chat;

      if (!targetChat && window.Store?.Chat) {
        targetChat = window.Store.Chat.get(chatId);
      }

      // 2. Resolve Send Actions & Key Factories
      const SendMsgAction = window.require ? window.require('WAWebSendMsgChatAction') : null;
      const MsgKeyMod = window.require ? window.require('WAWebMsgKey') : null;
      const MsgKey = MsgKeyMod?.default || MsgKeyMod;
      const UserPrefs = window.require ? window.require('WAWebUserPrefsMeUser') : null;
      const WidFactory = window.require ? window.require('WAWebWidFactory') : null;

      // 3. Resolve 'to' Wid
      const toWid = targetChat?.id || msg?.id?.remote || msg?.from || (WidFactory?.createWid ? WidFactory.createWid(chatId) : null);
      const isLid = String(toWid?._serialized || chatId).endsWith('@lid');

      // 4. Resolve 'from' (me) Wid
      const meWid = (isLid && UserPrefs?.getMaybeMeLidUser ? UserPrefs.getMaybeMeLidUser() : null)
        || UserPrefs?.getMaybeMePnUser?.()
        || UserPrefs?.getMaybeMeUser?.()
        || UserPrefs?.getMeUser?.();

      // 5. Generate message ID string
      let randomHex = '3EB0' + Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
      if (typeof MsgKey?.newId === 'function') {
        try { randomHex = await MsgKey.newId(); } catch (_) {}
      }

      // 6. Instantiate MsgKey so msgKey.remote is properly defined
      let msgKey;
      if (typeof MsgKey === 'function') {
        try {
          msgKey = new MsgKey({
            from: meWid,
            to: toWid,
            id: randomHex,
            selfDir: 'out'
          });
        } catch (_) {}
      }

      if (!msgKey || !msgKey.remote) {
        msgKey = {
          fromMe: true,
          remote: toWid,
          id: randomHex,
          self: 'out',
          _serialized: `true_${toWid?._serialized || chatId}_${randomHex}`
        };
      }

      // 7. Build full msgData payload expected by addAndSendMsgToChat
      const ephemeral = typeof targetChat?.getEphemeralSetting === 'function' ? targetChat.getEphemeralSetting() : undefined;
      const msgData = {
        id: msgKey,
        body: replyText,
        type: 'chat',
        subtype: null,
        t: Math.floor(Date.now() / 1000),
        from: meWid,
        to: toWid,
        self: 'out',
        ack: 0,
        local: true,
        isNewMsg: true,
        star: false,
        kicNotified: false,
        isForwarded: false,
        mentionedJidList: [],
        ...(ephemeral ? { ephemeralDuration: ephemeral } : {})
      };

      if (SendMsgAction?.addAndSendMsgToChat && targetChat) {
        try {
          const sendResult = SendMsgAction.addAndSendMsgToChat(targetChat, msgData);
          if (Array.isArray(sendResult)) {
            await Promise.all(sendResult);
          } else if (sendResult && typeof sendResult.then === 'function') {
            await sendResult;
          }
          console.log(`[WA Auto-Reply] Successfully sent via addAndSendMsgToChat to ${chatId}`);
          return true;
        } catch (sendErr) {
          console.warn(`[WA Auto-Reply] addAndSendMsgToChat failed for ${chatId}, trying chat.sendMessage:`, sendErr?.message || sendErr);
        }
      }

      // Fallback: chat.sendMessage
      if (targetChat && typeof targetChat.sendMessage === 'function') {
        try {
          await targetChat.sendMessage(replyText);
          console.log(`[WA Auto-Reply] Successfully sent via chat.sendMessage to ${chatId}`);
          return true;
        } catch (chatErr) {
          console.warn(`[WA Auto-Reply] chat.sendMessage failed for ${chatId}:`, chatErr?.message || chatErr);
        }
      }

      throw new Error('No direct internal send method available.');
    } catch (primaryErr) {
      console.warn(`[WA Auto-Reply] Primary send method threw for ${chatId}:`, primaryErr?.message || primaryErr);
      if (targetChat) {
        return await triggerDomComposeFallback(targetChat, replyText);
      }
      return false;
    }
  }

  // =========================================================================
  // Multi-Bubble AI Reply Sequencer
  // =========================================================================

  async function handleAiResponse(data) {
    const { chatId, replies } = data || {};
    if (!chatId || !Array.isArray(replies) || replies.length === 0) return;

    const requestAt = aiRequestStartedAt.get(chatId);
    if (requestAt) {
      console.log(`[WA Auto-Reply] AI response received in ${Date.now() - requestAt}ms (server+network).`);
      aiRequestStartedAt.delete(chatId);
    }
    const lastAt = lastMessageAtByChat.get(chatId);
    if (lastAt) {
      const total = Date.now() - lastAt;
      console.log(`[WA Auto-Reply] First bubble is ${total}ms after the last incoming message.`);
    }

    const ChatMod = window.require ? window.require('WAWebChatCollection') : null;
    const chatCollection = ChatMod?.ChatCollection || ChatMod?.default || ChatMod;
    const targetChat = chatCollection?.get ? chatCollection.get(chatId) : null;
    const lastMsg = lastReceivedMsgMap.get(chatId) || null;

    for (let i = 0; i < replies.length; i++) {
      const bubble = (replies[i] || '').trim();
      if (!bubble) continue;

      sentByAiTexts.add(bubble);
      if (sentByAiTexts.size > 2000) {
        const arr = Array.from(sentByAiTexts);
        arr.slice(0, 1000).forEach(t => sentByAiTexts.delete(t));
      }

      // Short human-ish pause between bubbles. Kept small so the whole
      // reply stays inside the 10s window.
      if (i > 0) {
        const elapsed = lastAt ? Date.now() - lastAt : 0;
        const pauseMs = elapsed > 9000 ? 0 : Math.min(800, Math.max(400, bubble.length * 5));
        if (pauseMs > 0) {
          console.log(`[WA Auto-Reply] Typing pause: ${pauseMs}ms before bubble #${i + 1}...`);
          await sleep(pauseMs);
        }
      }

      console.log(`[WA Auto-Reply] Sending bubble (${i + 1}/${replies.length}) to ${chatId}: "${bubble}"`);
      const sent = await sendBackgroundAutoReply(targetChat, chatId, bubble, lastMsg);
      console.log(`[WA Auto-Reply] Bubble ${i + 1}/${replies.length} result: ${sent ? 'SENT' : 'FAILED'}`);
      if (!sent) {
        console.warn(`[WA Auto-Reply] Bubble ${i + 1}/${replies.length} was NOT sent — check the send error above.`);
      }
    }
  }

  // =========================================================================
  // 7-Second Burst Debounce Timer Execution
  // =========================================================================

  async function onBurstTimerFired(chatId) {
    const buffer = dmBurstBuffers.get(chatId);
    if (!buffer) return;
    dmBurstBuffers.delete(chatId);

    // The initial media extraction started when the message arrived, so it
    // has had the full 7s burst. Don't block the reply beyond 150ms for late
    // media — the whole cycle must stay under 10s.
    await Promise.all(
      buffer.messages.map(async (item) => {
        if (item.mediaPromise) {
          try {
            item.media = await Promise.race([
              item.mediaPromise,
              sleep(150).then(() => null)
            ]);
          } catch (mediaErr) {
            console.warn('[WA Logger Internal] mediaPromise resolution error:', mediaErr);
            item.media = null;
          }
          delete item.mediaPromise;
        }

        if (!item.media) {
          console.log(`[WA Logger Internal] Media not ready at burst for ${item.msg?.type || 'message'}; proceeding to keep the 10s limit.`);
        }
      })
    );

    // Keep the total AI payload under the server's 50MB JSON limit and leave
    // headroom for multiple attachments in one burst.
    const MAX_AI_BURST_MEDIA_BASE64 = 24 * 1024 * 1024;
    let remainingMediaBudget = MAX_AI_BURST_MEDIA_BASE64;

    const incomingMessages = buffer.messages.map((item) => {
      let media = item.media || null;

      if (media?.base64Data) {
        if (media.base64Data.length > remainingMediaBudget) {
          media = { ...media, base64Data: null, skippedCombinedLimit: true };
        } else {
          remainingMediaBudget -= media.base64Data.length;
        }
      }

      return {
        text: item.text,
        timestamp: item.timestamp,
        media
      };
    });

    const chatObj = buffer.chatObj || (window.require ? window.require('WAWebChatCollection')?.ChatCollection?.get(chatId) : null);

    let chatHistory = [];
    if (chatObj?.msgs?.getModelsArray) {
      const allMsgs = chatObj.msgs.getModelsArray();
      const validHistorical = allMsgs.filter(m => {
        if (!m) return false;
        if (m.type === 'e2e_notification' || m.type === 'gp2' || m.type === 'protocol' || m.subtype === 'ciphertext') return false;
        const body = (m.body || m.caption || '').trim();
        return Boolean(body);
      });

      // Exclude the incoming burst items from the history tail
      let burstCount = incomingMessages.length;
      let idx = validHistorical.length - 1;
      const burstIds = new Set();
      while (idx >= 0 && burstCount > 0) {
        const m = validHistorical[idx];
        const isFromMe = Boolean(m.id?.fromMe || m.fromMe);
        if (!isFromMe) {
          burstIds.add(m.id?._serialized || m.id?.id);
          burstCount--;
        }
        idx--;
      }

      const historyCandidates = validHistorical.filter(m => !burstIds.has(m.id?._serialized || m.id?.id));
      chatHistory = historyCandidates.slice(-60).map(m => ({
        fromMe: Boolean(m.id?.fromMe || m.fromMe),
        text: formatMediaDisplayText(m),
        timestamp: formatTime(m.t)
      }));
    }

    const lastAt = lastMessageAtByChat.get(chatId);
    const sinceLast = lastAt ? Date.now() - lastAt : null;
    console.log(`[WA Internal] 7s burst debounce elapsed for ${buffer.meta.chatTitle || chatId}${sinceLast ? ` (${sinceLast}ms since last msg)` : ''}. Dispatching AI request (${incomingMessages.length} burst msgs, ${chatHistory.length} history msgs)...`);

    aiRequestStartedAt.set(chatId, Date.now());
    window.postMessage({
      source: 'WA_LOGGER_AI_REQUEST',
      payload: {
        chatId,
        chatTitle: buffer.meta.chatTitle,
        senderName: buffer.meta.senderName,
        senderNumber: buffer.meta.senderNumber,
        isSaved: buffer.meta.isSaved,
        incomingMessages,
        chatHistory
      }
    }, '*');
  }

  // =========================================================================
  // Incoming Message Handler
  // =========================================================================

  function handleIncomingMsg(msg) {
    try {
      if (!msg) return;
      if (!isEnabled) return;

      const chatId = msg.from?._serialized || msg.id?.remote?._serialized || String(msg.from || '');

      // 1. Strictly block WhatsApp Channels (@newsletter) & Status Broadcasts
      if (
        chatId.endsWith('@newsletter') ||
        chatId.endsWith('@broadcast') ||
        chatId === 'status@broadcast' ||
        Boolean(msg.chat?.isNewsletter) ||
        msg.type === 'newsletter' ||
        msg.broadcast ||
        (msg.id?.remote && String(msg.id.remote).endsWith('@newsletter'))
      ) {
        return;
      }

      // 2. Strictly ignore outgoing messages
      if (msg.id?.fromMe || msg.fromMe) return;

      // 3. Strictly ignore historical/old messages (must be isNewMsg and received after activation cutoff - 5s)
      if (!msg.isNewMsg) return;
      if (msg.t && msg.t < (activationTimeSec - 5)) return;

      // 4. Handle Ciphertext / Pending Decryption
      // WhatsApp adds media models as 'ciphertext' first, then mutates msg.type
      // to image/document/ptt/audio a few hundred milliseconds later.
      const isCiphertext = msg.type === 'ciphertext' || (!msg.type && msg.subtype === 'ciphertext');
      if (isCiphertext) {
        // Guard against attaching duplicate listeners on repeated add events.
        if (msg.__waLoggerCiphertextWatched) return;
        msg.__waLoggerCiphertextWatched = true;

        const retryIfDecrypted = () => {
          if (msg.type && msg.type !== 'ciphertext') {
            try { msg.off('change:type', retryIfDecrypted); } catch (_) {}
            handleIncomingMsg(msg);
          }
        };

        if (typeof msg.on === 'function') {
          msg.on('change:type', retryIfDecrypted);
        }

        // Backbone events can stay silent, so poll at 300/800/1500/3000ms too.
        [300, 800, 1500, 3000].forEach(delay => {
          setTimeout(retryIfDecrypted, delay);
        });
        return;
      }

      // Strictly allow only real user messages
      if (!ALLOWED_MSG_TYPES.has(msg.type)) return;

      // 5. Extract Message Content (Handling Media vs Text correctly)
      const MEDIA_TYPES = new Set(['image', 'video', 'document', 'sticker', 'ptt', 'audio']);
      const isMedia = MEDIA_TYPES.has(msg.type);

      let messageBody = '';
      if (isMedia) {
        messageBody = formatMediaDisplayText(msg);
      } else {
        messageBody = (msg.body || '').trim();
      }

      if (!messageBody) return;

      // Guard: never process AI's own sent replies
      if (sentByAiTexts.has(messageBody)) return;

      // 6. Deduplicate message IDs
      const msgId = msg.id?._serialized || msg.id?.id;
      if (!msgId || seenMsgIds.has(msgId)) return;
      seenMsgIds.add(msgId);
      if (seenMsgIds.size > 3000) {
        const ids = Array.from(seenMsgIds);
        ids.slice(0, 1500).forEach(id => seenMsgIds.delete(id));
      }

      // Cache as last received message for this chat
      lastReceivedMsgMap.set(chatId, msg);

      // 7. Group vs 1-on-1 Chat Resolution
      const isGroup = chatId.endsWith('@g.us') || Boolean(msg.author);

      let chat = msg.chat;
      if (!chat && typeof window.require === 'function') {
        try {
          chat = window.require('WAWebChatCollection')?.ChatCollection?.get(chatId);
        } catch (e) {}
      }

      if (chat?.isNewsletter) return;

      const chatDisplayName = chat?.formattedTitle || chat?.name || chat?.contact?.name || chat?.contact?.pushname || '';
      const rawSenderJid = isGroup ? (msg.author?._serialized || msg.author || '') : chatId;

      let ContactCollection = null;
      if (typeof window.require === 'function') {
        try {
          ContactCollection = window.require('WAWebContactCollection')?.ContactCollection;
        } catch (e) {}
      }

      const senderContact = msg.senderObj || (rawSenderJid && ContactCollection?.get ? ContactCollection.get(rawSenderJid) : null);

      let resolvedPhone = '';
      if (rawSenderJid.endsWith('@lid')) {
        const phoneFromObj = senderContact?.phoneNumber?._serialized || senderContact?.id?.user;
        if (phoneFromObj && !String(phoneFromObj).includes('_')) {
          resolvedPhone = formatPhoneNumber(String(phoneFromObj));
        }
      } else {
        resolvedPhone = formatPhoneNumber(rawSenderJid);
      }

      if (!resolvedPhone && senderContact?.id?.user) {
        resolvedPhone = formatPhoneNumber(String(senderContact.id.user));
      }

      const isAddressBook = senderContact?.isAddressBookContact === true || Boolean(senderContact?.name);
      const savedName = (isAddressBook && (senderContact?.name || senderContact?.shortName)) ||
                        (!isGroup && chat?.contact?.name) ||
                        null;

      let chatTitle = '';
      let senderName = '';
      let senderNumber = '';
      let isSaved = false;

      if (isGroup) {
        chatTitle = chatDisplayName || (msg.chatTitle || 'Group');
        senderName = savedName || senderContact?.pushname || msg.notifyName || 'Unknown';
        senderNumber = resolvedPhone || senderName;
        isSaved = Boolean(savedName);
      } else {
        if (savedName) {
          chatTitle = savedName;
          senderName = savedName;
          senderNumber = resolvedPhone || 'Saved';
          isSaved = true;
        } else {
          chatTitle = resolvedPhone || chatDisplayName || 'Unknown';
          senderName = 'Unknown';
          senderNumber = resolvedPhone || 'Unknown';
          isSaved = false;
        }
      }

      const timestamp = formatTime(msg.t);

      // Trigger background contact sync on message arrival
      syncOneOnOneContacts();

      // =========================================================================
      // Routing: Group Chats vs 1-on-1 DMs
      // =========================================================================

      if (isGroup) {
        // Groups: emit immediately for terminal logging; NEVER auto-reply
        window.postMessage({
          source: 'WA_LOGGER_INTERNAL',
          payload: {
            isGroup: true,
            isSaved,
            chatTitle,
            senderName,
            senderNumber,
            message: messageBody,
            timestamp,
            autoReplied: false,
            cooldownActive: false
          }
        }, '*');
        return;
      }

      // 1-on-1 DM:
      if (!autoReplyEnabled) {
        // If auto-reply is disabled, emit immediately to terminal logger
        window.postMessage({
          source: 'WA_LOGGER_INTERNAL',
          payload: {
            isGroup: false,
            isSaved,
            chatTitle,
            senderName,
            senderNumber,
            message: messageBody,
            timestamp,
            autoReplied: false,
            cooldownActive: false
          }
        }, '*');
        return;
      }

      // Auto-reply is ENABLED: Push to 7-second burst buffer
      lastMessageAtByChat.set(chatId, Date.now());
      const hasMedia = SUPPORTED_MEDIA_TYPES.has(msg.type);
      const mediaPromise = hasMedia ? extractMessageMedia(msg) : null;
      const burstItem = { text: messageBody, timestamp, msg, mediaPromise, media: null };
      let buffer = dmBurstBuffers.get(chatId);

      if (buffer) {
        clearTimeout(buffer.timer);
        buffer.messages.push(burstItem);
        buffer.chatObj = chat;
        buffer.lastMsg = msg;
        buffer.meta = { chatId, chatTitle, senderName, senderNumber, isSaved };
      } else {
        buffer = {
          timer: null,
          messages: [burstItem],
          chatObj: chat,
          lastMsg: msg,
          meta: { chatId, chatTitle, senderName, senderNumber, isSaved }
        };
        dmBurstBuffers.set(chatId, buffer);
      }

      console.log(`[WA Internal] Buffered 1-on-1 DM from ${chatTitle} ("${messageBody}"). Burst count: ${buffer.messages.length}.${hasMedia ? ' Initiated in-memory media download.' : ''} Reset 7s burst debounce timer.`);

      buffer.timer = setTimeout(() => {
        onBurstTimerFired(chatId);
      }, 7000);

    } catch (err) {
      console.warn('[WA Logger Internal] Error handling incoming message:', err);
    }
  }

  // =========================================================================
  // Internal Store Hooking
  // =========================================================================

  function tryHookInternalStore() {
    if (isHooked) return;

    try {
      // Method 1: window.require('WAWebMsgCollection')
      if (typeof window.require === 'function') {
        const MsgCollection =
          window.require('WAWebMsgCollection')?.MsgCollection ||
          window.require('WAWebCollections')?.MsgCollection;

        if (MsgCollection && typeof MsgCollection.on === 'function') {
          MsgCollection.on('add', (msg) => {
            if (msg) handleIncomingMsg(msg);
          });
          isHooked = true;
          console.log('[WA Logger Internal] 100% Hooked via window.require (WAWebMsgCollection).');
          window.postMessage({ source: 'WA_LOGGER_INTERNAL_READY', method: 'require' }, '*');

          // Initial contact sync & 15s recurring sync
          syncOneOnOneContacts();
          setInterval(syncOneOnOneContacts, 15000);
          return;
        }
      }

      // Method 2: Webpack chunk inspection
      if (window.webpackChunkwhatsapp_web_client && !isHooked) {
        window.webpackChunkwhatsapp_web_client.push([
          [['wa_internal_hook_' + Date.now()]],
          {},
          (req) => {
            try {
              if (!req?.c) return;
              for (const id in req.c) {
                const mod = req.c[id]?.exports;
                if (!mod) continue;

                const MsgCollection =
                  mod.MsgCollection ||
                  (mod.default && mod.default.MsgCollection) ||
                  (mod.Msg && mod.Msg.collection);

                if (MsgCollection && typeof MsgCollection.on === 'function') {
                  MsgCollection.on('add', (msg) => {
                    if (msg) handleIncomingMsg(msg);
                  });
                  isHooked = true;
                  console.log('[WA Logger Internal] 100% Hooked via Webpack module cache.');
                  window.postMessage({ source: 'WA_LOGGER_INTERNAL_READY', method: 'webpack' }, '*');

                  // Initial contact sync & 15s recurring sync
                  syncOneOnOneContacts();
                  setInterval(syncOneOnOneContacts, 15000);
                  return;
                }
              }
            } catch (e) {}
          }
        ]);
      }
    } catch (err) {}

    attempts++;
    if (!isHooked && attempts < MAX_ATTEMPTS) {
      setTimeout(tryHookInternalStore, 1000);
    }
  }

  // Start hooking
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(tryHookInternalStore, 1000);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(tryHookInternalStore, 1000));
  }
})();
