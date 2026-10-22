# WhatsApp Web Terminal Logger

A local tool that watches your WhatsApp Web messages, prints them neatly in a terminal, and (optionally) replies to 1-on-1 chats automatically using Google Gemini. It also includes a browser dashboard for browsing recent chat history and a built-in Turabees fabric assistant.

Everything runs on your own computer. There is no cloud database and no external service other than the Gemini API used for generating replies.

---

## Table of contents

- [What this project does](#what-this-project-does)
- [How the pieces fit together](#how-the-pieces-fit-together)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Setup](#setup)
- [Configuration](#configuration)
- [The browser extension](#the-browser-extension)
- [Message capture rules](#message-capture-rules)
- [Automatic replies](#automatic-replies)
- [Media and file support](#media-and-file-support)
- [The AI reply pipeline](#the-ai-reply-pipeline)
- [The Turabees fabric assistant](#the-turabees-fabric-assistant)
- [The dashboard](#the-dashboard)
- [HTTP API reference](#http-api-reference)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Security, privacy and limitations](#security-privacy-and-limitations)

---

## What this project does

- Streams incoming WhatsApp Web messages to a terminal with colors and timestamps.
- Separates group messages from 1-on-1 messages and shows saved vs unsaved contacts properly.
- Buffers rapid 1-on-1 messages for 7 seconds so a burst is answered as one conversation turn.
- Generates short, human-sounding replies as "John" from Turabees using Google Gemini.
- Matches the language of the newest message: English, Roman Urdu, or Urdu script.
- Uses a formal or casual tone depending on the contact ("sir" vs "yaar").
- Answers fabric questions from a real Turabees workbook and refuses to invent data.
- Reads attachments: images, stickers, voice notes, audio, PDF, Word, Excel, PowerPoint, text, CSV and JSON.
- Sends replies directly inside WhatsApp Web in multiple short bubbles.
- Syncs 1-on-1 contacts to a local dashboard.
- Lets you fetch recent message history for any contact from that dashboard.
- Provides on/off switches for logging and auto-reply.

---

## How the pieces fit together

```
WhatsApp Web tab
  |
  |  injected.js  (hooks WhatsApp's internal message store)
  v
content.js  (bridge inside the page)
  |
  |  chrome.runtime messages
  v
background.js  (extension service worker)
  |
  |  HTTP to http://localhost:3000
  v
Node.js Express server (server/server.js)
  |            |              |
  |            |              +--> Turabees dataset (fabrics.json)
  |            +-----------------> Google Gemini API
  +------------------------------> Terminal output
                                 |
                                 +--> Dashboard (public/index.html)
```

Step by step:

1. `content.js` injects `injected.js` into the WhatsApp Web page.
2. `injected.js` hooks WhatsApp's internal message collection and sees new messages as they arrive.
3. It filters and formats each message, then posts it to `content.js` with `window.postMessage`.
4. `content.js` forwards it to `background.js` with `chrome.runtime.sendMessage`.
5. `background.js` sends an HTTP request to the local server.
6. The server prints the message, or calls Gemini and returns reply bubbles.
7. Replies go back through the same chain and are sent from inside WhatsApp Web.

The dashboard uses a second path: the browser asks the server for history, the server queues a command, the extension polls for commands, asks WhatsApp Web for the messages, and posts the result back to the server.

---

## Project structure

```
whatsapp-terminal-logger/
├── extension/
│   ├── manifest.json      Chrome extension definition (Manifest V3)
│   ├── background.js      Service worker: server calls and command polling
│   ├── content.js         Bridge between the page and the extension
│   ├── injected.js        Main engine: hooks WhatsApp, buffers, sends replies
│   ├── popup.html         Extension popup markup and styles
│   └── popup.js           Popup logic: health check and toggles
│
├── server/
│   ├── server.js          Express server, logging, Gemini, history bridge
│   ├── turabees-data.js   Fabric search, relevance scoring, count answers
│   ├── package.json       Server dependencies and start script
│   ├── config.example.json  Template configuration
│   ├── config.json        Your real configuration (not committed to git)
│   ├── test.js            Test for /log-message
│   ├── test_ai_reply.js   Test for health, contacts and /ai-reply
│   ├── test_multimodal.js Test for an image attachment
│   ├── public/
│   │   └── index.html     The Recent Chats Explorer dashboard
│   └── data/turabees/
│       ├── fabrics.json           Normalized workbook data (3.2 MB)
│       ├── turabees-profile.md    Brand and service facts
│       └── README.md              Dataset notes
│
├── package-lock.json      Empty root lockfile (dependencies live in server/)
└── README.md              This file
```

---

## Requirements

- Windows, macOS or Linux.
- Google Chrome (or another Chromium browser that supports Manifest V3 extensions).
- Node.js 18 or newer (Node 20+ recommended).
- A Google Gemini API key (one or more).
- A WhatsApp account, logged in at <https://web.whatsapp.com>.
- The WhatsApp Web tab must stay open for the extension to work.

---

## Setup

### 1. Install server dependencies

```powershell
cd server
npm install
```

### 2. Create your configuration

Copy the example file and edit it:

```powershell
Copy-Item config.example.json config.json
```

On macOS or Linux:

```bash
cp config.example.json config.json
```

Open `server/config.json` and paste your Gemini API key(s):

```json
{
  "geminiModel": "gemini-2.5-flash",
  "debounceSeconds": 7,
  "geminiApiKeys": [
    "YOUR_GEMINI_API_KEY"
  ]
}
```

You can provide several keys. The server rotates through them automatically when one is rate-limited or out of quota.

`config.json` is listed in `.gitignore`, so it is not committed. Keep it private.

### 3. Start the server

```powershell
cd server
npm start
```

The terminal shows a startup banner with the model, the number of loaded keys, and the available endpoints. The server listens on port 3000 by default.

### 4. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension` folder in this project.
5. Open <https://web.whatsapp.com> and log in.
6. Reload the WhatsApp Web tab after installing or updating the extension.

### 5. Check that it works

- Send yourself or receive a message from another phone.
- The message should appear in the server terminal.
- Click the extension icon. The popup should show **Server: Online**.
- For a 1-on-1 message with auto-reply on, a reply should arrive after roughly 7 seconds plus generation time (usually 1-3 seconds).

---

## Configuration

The server reads `server/config.json` on every AI request, so edits apply without restarting for model and keys. Some values are read once at startup for the banner.

| Setting | Where | Default | What it does |
|---|---|---|---|
| `geminiModel` | `config.json` | `gemini-2.5-flash` | Primary Gemini model. The code tries this first, then `gemini-3.5-flash` as a fallback. |
| `debounceSeconds` | `config.json` | `7` | Shown in the banner only. The extension currently hardcodes the 7-second burst window. |
| `geminiApiKeys` | `config.json` | none | Array of API keys. Placeholder keys starting with `PASTE_` are ignored. |
| `GEMINI_API_KEYS` | environment | none | Comma-separated extra keys, appended to the config list. |
| `PORT` | environment | `3000` | Server port. The extension is hardcoded to port 3000. |

Other fixed values:

- Request body limit: 50 MB.
- Total inline file budget sent to Gemini: 15 MB.
- Maximum media per message burst: 24 MB of base64.
- Single media file download guard: 15 MB.
- Dashboard media display guard: 2 MB per file.
- Gemini reply deadline: 15 seconds.
- Each Gemini attempt timeout: 8 seconds, or less if the deadline is close.
- Extension safety timeout for `/ai-reply`: 18 seconds.

---

## The browser extension

### Popup

The popup has a dark interface with two controls and a server indicator.

- **Server status** - checks `http://localhost:3000/health` with a 2-second timeout. Shows Online or Offline.
- **Log Messages** - turns message capture and terminal logging on or off. Default: on.
- **Auto-Reply (1-on-1 DMs)** - turns Gemini replies on or off. Default: on.

Both switches are saved in `chrome.storage.local` and broadcast to every open WhatsApp Web tab. The background worker also checks these switches before sending anything to the server, so turning a switch off stops the work at all layers.

### Background service worker (`background.js`)

- Sets default switch values the first time the extension is installed.
- Routes four kinds of requests:
  - `NEW_WA_MESSAGE` to `POST /log-message`
  - `WA_LOGGER_AI_REQUEST` to `POST /ai-reply`
  - `WA_LOGGER_SYNC_CONTACTS` to `POST /api/sync-contacts`
  - `WA_LOGGER_HISTORY_RESULT` to `POST /api/command-result`
- Polls `GET /api/poll-commands` every 1.5 seconds for dashboard history requests.
- Forwards history commands to the first open WhatsApp Web tab.

### Content bridge (`content.js`)

- Injects `injected.js` into the page's main world, which is required to reach WhatsApp's internal JavaScript modules.
- Relays messages in both directions.
- Keeps its own copy of the two switches so it can stop forwarding instantly.

### Injected engine (`injected.js`)

This is the core of the extension.

- **Connects to WhatsApp** - finds the internal `WAWebMsgCollection` using `window.require(...)`. If that fails, it searches the Webpack module cache. It retries up to 60 times, once per second.
- **Listens for new messages** - every new message in the store is passed through the filter and formatting logic.
- **Waits for decryption** - media messages often arrive as `ciphertext` first. The engine listens for a type change and also rechecks at 300 ms, 800 ms, 1.5 s and 3 s.
- **Reads contacts** - resolves saved names, push names and phone numbers, including WhatsApp's newer `@lid` identifiers.
- **Syncs contacts** - sends the 1-on-1 contact list when a message arrives and every 15 seconds. Syncing is throttled to at most once every 2 seconds.
- **Buffers DMs** - collects all messages from the same chat into a 7-second burst.
- **Downloads media in memory** - uses WhatsApp's in-memory blob cache and `downloadMedia`, with thumbnail fallbacks.
- **Sends AI replies** - tries WhatsApp's internal send action, then `chat.sendMessage`, then a DOM fallback that types into the message box and presses Send.
- **Answers history requests** - loads older messages when asked and formats them for the dashboard.
- **Prevents loops** - remembers text it sent so it never replies to itself, and remembers message IDs so duplicates are ignored.

---

## Message capture rules

Not every event in WhatsApp is a message worth logging. The engine applies these rules:

| Rule | Behavior |
|---|---|
| Outgoing messages | Ignored completely. |
| Channels and newsletters (`@newsletter`) | Ignored. |
| Status broadcasts (`status@broadcast`, `@broadcast`) | Ignored. |
| Old history messages | Ignored unless they were received after the logger was enabled. A 5-second grace window is allowed. |
| Duplicate message IDs | Ignored. The engine keeps the last 3,000 IDs. |
| Ciphertext messages | Rechecked until WhatsApp decrypts them. |
| Unsupported types | Ignored. Supported types are text, image, video, audio, voice note, document, sticker, location and contact card. |
| Empty content | Ignored. |
| Messages sent by the auto-reply itself | Ignored. |

### How messages look in the terminal

Group message:

```
[time] GROUP MESSAGE
Group  : Family Group by (+923001234567)
Message: Are we meeting tomorrow?
```

Saved 1-on-1 contact:

```
[time] 1-ON-1 MESSAGE
Sender : Ali Khan
Message: Hello bhai
```

Unsaved 1-on-1 contact:

```
[time] 1-ON-1 MESSAGE
Sender : Unknown (+923001234567)
Message: Hello
```

### Logging vs auto-reply routing

- **Group messages** are logged immediately and never get an AI reply.
- **1-on-1 messages with auto-reply off** are logged immediately.
- **1-on-1 messages with auto-reply on** are held for 7 seconds and then sent to Gemini. They are not printed separately as plain incoming messages; the AI reply block shows them.

---

## Automatic replies

Auto-reply applies to 1-on-1 chats only.

### The 7-second burst window

1. The first new DM from a contact starts a 7-second timer.
2. Each additional message from that contact resets the timer.
3. When 7 seconds pass with no new message, all buffered messages are sent to the server together.
4. Media downloads start as soon as each message arrives, so they usually finish during the wait.
5. Up to 60 earlier messages from the chat are included as conversation history.
6. The media portion is capped at 24 MB of base64 for the whole burst. Extra files are still acknowledged by name but not attached.

The goal is to answer a person who sends several short messages in a row, not to answer each fragment separately.

### Language matching

The reply language is based on the newest incoming DM, not the older history.

| Incoming message | Reply language |
|---|---|
| Plain English | English |
| Roman Urdu (`kya`, `bhai`, `hai`, `acha`) | Roman Urdu |
| Urdu script | Urdu script |
| Explicit request like "reply in English" | The requested language |
| Explicit request like "Urdu mein jawab do" | The requested language |
| Explicit request like "Roman Urdu mein" | Roman Urdu |

When the language is English, Roman Urdu filler words are cleaned out of the generated reply, and a final check prevents mixed-language output.

### Tone matching

- If the contact's name, chat title or message includes words such as `sir`, `sahab`, `janab`, `mr`, `mrs`, `dr`, `uncle`, `aunty`, `boss`, or `aap`/`aapka`, the reply uses "sir" and a respectful tone.
- Otherwise the reply is casual and may use "yaar".

### The "John" persona

The system prompt tells the model to behave as John, a real member of the Turabees team:

- Never admit to being an AI, bot or assistant.
- Use short WhatsApp-style messages, usually one or two bubbles.
- No markdown, bullet points or corporate language.
- Light small talk and gossip are allowed.
- Unrelated topics get a short, natural steer back to Turabees and fabrics.
- Personal questions are answered from contact details and chat history.
- Turabees questions are answered from the profile and fabric dataset.
- Exact counts come from the dataset's precomputed answers, never from estimation.
- Missing details are handled with a short follow-up or the official contact details.

### Sending the bubbles

- The model returns `{ "replies": ["first bubble", "second bubble"] }`.
- Bubbles are sent one at a time in order.
- A 400-800 ms pause between bubbles makes the reply feel typed rather than pasted.
- The pause is skipped if the conversation is already near the 10-second mark.
- Every bubble logs whether it was sent or failed.
- Send order: internal WhatsApp send action, then `chat.sendMessage`, then DOM typing plus Send or Enter.

### When Gemini is not used

A short fallback line is sent when:

- No API keys are configured.
- Every key is rate-limited or fails.
- The 15-second server deadline is reached.

Fallback lines exist in English, Roman Urdu and Urdu, in both respectful and casual forms. A separate "file steer" line is used when the model returns nothing while an attachment is present.

---

## Media and file support

### How media is captured

- WhatsApp sometimes reports no MIME type. The engine infers it from the filename, then from the message type.
- It first tries `downloadMedia`, then reads from `InMemoryMediaBlobCache`, then `mediaObject.mediaBlob`, then any blob URL.
- If a full download fails, an image thumbnail can still be used for images and stickers.
- Files above 15 MB are not downloaded. Their thumbnail is kept, and the model is told the file was too large.

### What the AI receives

| Attachment | What Gemini gets |
|---|---|
| Image | Full image if available, otherwise a thumbnail |
| Sticker | Full sticker or thumbnail |
| Image sent as a document | Full image if available, otherwise a thumbnail |
| Voice note | Full audio, up to the inline budget |
| Audio file | Full audio, up to the inline budget |
| PDF | Full PDF, or locally extracted text (text extraction is preferred and fast) |
| Word `.docx` | Text extracted locally |
| Excel `.xlsx` / `.xlsm` | Sheet names and shared text extracted locally |
| PowerPoint `.pptx` | Slide text extracted locally |
| TXT, CSV, JSON, Markdown, code files | First 30,000 characters |
| Video | Only the message text (`[Video]`); no full video is downloaded |
| Other documents | Acknowledged by filename, MIME type and size, with a preview image if available |

Limits:

- 15 MB total inline data per Gemini request.
- 24 MB of base64 per message burst.
- 30,000 characters per extracted document.
- 2 MB per file for dashboard media previews.

If a file is related to Turabees, the model reads it and answers. If it is unrelated, the model does not analyze it and sends a short steer-back line.

---

## The AI reply pipeline

When `POST /ai-reply` is called, the server performs these steps:

1. **Load the request** - chat ID, title, sender name, sender number, saved status, incoming messages and chat history.
2. **Merge memory** - combines this chat's stored memory with the history sent by the extension, removes duplicates, and keeps the last 80 messages for the prompt.
3. **Detect tone and language** - respectful or casual, English or Roman Urdu or Urdu.
4. **Extract PDF text locally** - with a 900 ms race, so a slow PDF does not delay everything. The PDF base64 is removed once text is extracted.
5. **Assess relevance** - checks whether the message is about Turabees or fabrics.
6. **Build context** - profile, statistics, authoritative count answers and the most relevant dataset rows.
7. **Build the prompt** - persona, contact details, history, incoming messages, attachment notes and a mandatory language instruction.
8. **Call Gemini** - with `temperature: 0.9`, `maxOutputTokens: 160`, and JSON response mode.
9. **Parse the reply** - accepts clean JSON and also salvages truncated JSON.
10. **Localize** - for English, removes Roman Urdu filler words.
11. **Remember the exchange** - stores up to 150 messages per contact in memory.
12. **Log and return** - prints a formatted block and returns `{ replies }`.

### API key rotation and failover

The server keeps a current key index.

- **HTTP 429 or 403** (rate limit or quota): switch to the next key.
- **HTTP 503 or 404** (service spike or model unavailable): try the next model.
- **Other HTTP errors**: log and try the next model.
- **Timeout**: try the next key.
- **All keys exhausted**: return a fallback line.

Models tried for each key: the configured model first, then `gemini-3.5-flash`.

### Chat memory

- Each chat keeps up to 150 messages in memory.
- Memory is keyed by chat ID, falling back to phone number, then chat title.
- Memory is used so John can answer questions like "what did I tell you earlier?"
- Memory is lost when the server restarts.

---

## The Turabees fabric assistant

The server contains a local search and answer engine in `turabees-data.js`. It does not send the whole 3.2 MB workbook to Gemini. Instead it sends a compact, relevant slice.

### What the dataset contains

| Sheet | Data rows |
|---|---:|
| `fabrics.csv` | 3,603 |
| `suit fabrics` | 3,612 |
| `Final 90 fabrics` | 112 |
| `Final Sehrwani fabrics` | 218 |
| `accessories` | 2 |
| `Image generation pipeline` | 49 |
| `Sheet6` | 1 |
| **All sheets** | **7,597** |

The four fabric sheets contain:

- 7,545 data rows
- 3,831 unique catalog codes
- 257 unique fabric names

The `accessories` sheet contains the Royal Embroidered Stole and Heritage Zari Khussa, with prices, colors, sizes, stock, lead time and matching categories.

### How relevance is decided

The engine recognizes:

- The brand name and common misspellings, including spelling distance up to two letters.
- Sheet names and aliases, such as "suit fabrics" or "final sherwani".
- Six- to eight-digit catalog codes.
- Known fabric names from the workbook.
- Colors, patterns, fabric types, garment categories and seasons.
- Count questions such as "how many rows", "how many suits" or "kitne".
- Follow-up questions when the recent history was already about Turabees.
- Acknowledgements such as "ok" or "thanks", which are not treated as fabric questions.

Each message gets a relevance result with a reason. If the message is not related, John does not answer it and steers the conversation back to Turabees.

### Count answers

For count questions, the server computes the number from the dataset and labels it authoritative. This prevents the model from guessing. Examples:

- Rows in a specific sheet.
- Rows across all sheets.
- Unique catalog codes.
- Unique colors, fabric types, patterns or seasons.
- Suit, sherwani, prince-coat or waistcoat counts.
- Accessory counts.

### Row search

- Builds a searchable index of every row at startup.
- Filters by sheet, catalog code, colors, patterns, fabrics, categories and seasons.
- Scores rows by exact code match, token matches, complete token matches and phrase matches.
- Returns up to 10 rows, formatted as short labeled records.
- Never invents prices, stock or availability. If something is missing, John says so and offers `info@turabees.com` or `+44 7751 149279`.

### Brand facts included

The profile file also supplies:

- Turabees is a wedding couture atelier.
- Collections: waistcoats, sherwanis, prince suits, suits, tuxedos, dinner suits.
- Fabrics: European wools, Italian silks, brocades, heritage weaves.
- Bespoke process, measurements, 6-8 week timeline and international service.
- Official contact details and UK office address.

---

## The dashboard

The server serves a single-page dashboard at <http://localhost:3000>. It is styled like WhatsApp in dark mode.

### Header

- Server status and Gemini model name from `/health`.
- Number of configured Gemini keys.
- Number of synced contacts.
- **Refresh Contacts** - fetches the contact list again.
- **Copy Filtered Chat** - copies the currently visible messages to the clipboard as plain text.

### Contact sidebar

- Lists every synced 1-on-1 contact, most recent first.
- Shows saved or unsaved status and the phone number.
- Has its own search box for names and numbers.
- Clicking a contact selects it. You still need to click **Fetch Recent Chats** to load messages.

### Control bar

1. **Select a contact** - dropdown with the same contact list.
2. **Choose a range** - presets 10, 25, 50 or 100, or type any number from 1 to 500.
3. **Choose a filter** - Complete Chat, Only Theirs, or Only Mine.

### Fetching history

1. The dashboard calls `GET /api/chat-history`.
2. The server creates a request ID and queues a command.
3. The extension polls, picks up the command, and forwards it to WhatsApp Web.
4. The injected engine loads older messages if needed, formats them, and returns them.
5. The server resolves the waiting request.
6. If the extension does not answer within 12 seconds, the dashboard receives a timeout error.

The engine makes up to three attempts to load older message batches, waiting at most 1.2 seconds per batch.

### Message display

- Messages appear as WhatsApp-style incoming and outgoing bubbles.
- Date dividers group messages by day.
- Each bubble shows sender, date, time and delivery checks for outgoing messages.
- Each bubble has a Copy button.
- Media is rendered as:
  - Image preview, clickable to open full size.
  - Video preview or thumbnail.
  - Document card with filename, type and size, plus a download link when available.
  - Audio player for voice notes and audio files.
- Media larger than 2 MB is not embedded as a data URL.
- `blob:` URLs from WhatsApp are not used in the dashboard because they do not work outside that page.

### Search and export

- The in-chat search filters messages by text.
- Counters show totals for all messages, their messages and your messages.
- Export copies the filtered chat as a readable text transcript.

### Auto-refresh

- Server health and contacts refresh every 5 seconds.
- Contacts also arrive automatically from the extension, so the sidebar fills without pressing Refresh.

---

## HTTP API reference

All endpoints are open to any caller. There is no authentication.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/log-message` | Print a message in the terminal. |
| `POST` | `/ai-reply` | Generate and return AI reply bubbles. |
| `POST` | `/api/sync-contacts` | Replace the in-memory contact list. |
| `GET` | `/api/contacts` | Return the contact list. |
| `GET` | `/api/poll-commands` | Extension picks up the next queued command. |
| `POST` | `/api/command-result` | Extension returns history results. |
| `GET` | `/api/chat-history` | Dashboard requests history for one contact. |
| `GET` | `/health` | Server status, model and key count. |
| `GET` | `/` | The dashboard page. |

### `POST /log-message`

```json
{
  "isGroup": false,
  "isSaved": true,
  "chatTitle": "Ali Khan",
  "senderName": "Ali Khan",
  "senderNumber": "+923001234567",
  "message": "Hello",
  "timestamp": "19:55:10",
  "autoReplied": false,
  "cooldownActive": false
}
```

Returns `{ "success": true, "loggedAt": "..." }`.

### `POST /ai-reply`

```json
{
  "chatId": "923001234567@c.us",
  "chatTitle": "Ali Khan",
  "senderName": "Ali Khan",
  "senderNumber": "+923001234567",
  "isSaved": true,
  "incomingMessages": [
    {
      "text": "Price of RIVIERA?",
      "timestamp": "19:55:10",
      "media": {
        "hasMedia": false
      }
    }
  ],
  "chatHistory": [
    { "fromMe": false, "text": "Hello", "timestamp": "19:50:00" }
  ]
}
```

Returns:

```json
{
  "success": true,
  "replies": ["...", "..."],
  "usedKeyIndex": 1,
  "model": "gemini-2.5-flash"
}
```

### `POST /api/sync-contacts`

```json
{
  "contacts": [
    {
      "chatId": "923001234567@c.us",
      "name": "Ali Khan",
      "number": "+923001234567",
      "isSaved": true,
      "lastMsgTime": 1729000000,
      "unreadCount": 0
    }
  ]
}
```

Returns the number of stored contacts.

### `GET /api/contacts`

Returns `{ "success": true, "count": 0, "contacts": [] }`.

### `GET /api/chat-history`

Query parameters:

- `chatId` (required)
- `limit` (default 50)
- `filter` (`all`, `them`, `me`; accepted but currently not applied by the extension)

Returns `{ success, chatId, messages, error }` or a 504 timeout error after 12 seconds.

### `GET /api/poll-commands`

Returns `{ "command": { ... } }` or `{ "command": null }`. The command is removed from the queue when returned.

### `POST /api/command-result`

Accepts `{ requestId, chatId, messages, success, error }` and resolves the waiting dashboard request. Returns `{ acknowledged: true }` or `{ acknowledged: false }`.

### `GET /health`

```json
{
  "status": "running",
  "geminiModel": "gemini-2.5-flash",
  "keysConfigured": 1,
  "contactsCached": 12
}
```

---

## Tests

The test files are small HTTP clients. Start the server first, then run them in another terminal.

```powershell
cd server
npm start
```

```powershell
# In a second terminal
node test.js            # tests /log-message with three example messages
node test_ai_reply.js   # tests /health, contacts sync, and /ai-reply
node test_multimodal.js # tests an image attachment with a 1x1 PNG
```

`test_ai_reply.js` uses a sample conversation about university assignments. Because unrelated topics are steered back to Turabees, the reply will not answer the assignment question. This is intended behavior.

`test_multimodal.js` sends a tiny PNG so you can verify that image data reaches Gemini without needing a real phone.

These are manual integration tests. There is no automated test runner and no mocked Gemini server.

---

## Troubleshooting

### The popup says "Server: Offline"

- Make sure `npm start` is running inside `server/`.
- Check that port 3000 is free.
- Visit <http://localhost:3000/health> in the browser.

### Messages do not appear in the terminal

- Confirm the **Log Messages** toggle is on.
- Reload the WhatsApp Web tab after installing the extension.
- Keep WhatsApp Web open and logged in.
- Old messages received before activation are intentionally ignored. Send a new message to test.
- Open the WhatsApp Web console and look for `[WA Logger Internal]`. If you see repeated hook attempts, WhatsApp's internal module names may have changed after an update.

### Auto-reply does not send

- Confirm the **Auto-Reply** toggle is on.
- Confirm the chat is a 1-on-1 chat, not a group.
- Check the server terminal for Gemini errors: no keys, 429, 403, 503, timeout.
- Confirm `config.json` has at least one valid key.
- If replies are generated but not delivered, check for `[WA Auto-Reply]` errors. WhatsApp may have changed its internal send action.
- The extension aborts `/ai-reply` after 18 seconds as a safety net.

### Replies are in the wrong language

- Language follows the newest incoming message. Older English history does not force English.
- An explicit request such as "reply in English" or "Roman Urdu mein jawab do" overrides the automatic detection.
- Urdu script messages always produce Urdu script replies.

### The dashboard times out

- WhatsApp Web must be open in a tab with the extension active.
- The extension must be polling; it does so every 1.5 seconds.
- Very old history may take several batch loads. Lower the requested count and try again.

### Dashboard shows no contacts

- Contacts sync automatically every 15 seconds and when a message arrives.
- Press **Refresh Contacts**.
- Make sure the extension is enabled.

### "Chat not found in ChatCollection"

- The contact may not be loaded in WhatsApp Web yet. Open that chat in WhatsApp Web once, then fetch again.

### Gemini replies are empty or malformed

- The server tries to salvage truncated JSON.
- If it still fails, the fallback or steer line is used.
- `maxOutputTokens` is limited to 160, which keeps replies short.

### WhatsApp Web updated and nothing works

This project relies on private WhatsApp modules. An update can rename them. The extension retries the hook for 60 seconds, but if the module names change, `injected.js` must be updated. This is an expected maintenance cost of working this way.

---

## Security, privacy and limitations

### Secrets

- `server/config.json` contains your Gemini keys and is excluded from git.
- Never commit or share that file.
- If a key is exposed, revoke it in Google AI Studio and create a new one.
- Environment variables can be used instead of storing keys in the file.

### Server exposure

- The server has no authentication and allows all CORS origins.
- It listens on all network interfaces by default.
- Anyone who can reach port 3000 can call `/ai-reply`, read synced contacts, or request chat history.
- For safer use, bind only to localhost by changing `app.listen(PORT, ...)` to `app.listen(PORT, '127.0.0.1', ...)`, or block the port in your firewall.

### Data handling

- No database is used.
- Contacts, chat memory and command queues live in memory and disappear on restart.
- Messages are not written to disk.
- Chat history is requested on demand and returned to the browser; it is not stored by the server.
- Media is downloaded into the WhatsApp page's memory and forwarded only as needed.
- Generated replies and attachments are sent to Google's Gemini API.

### Account and platform risk

- The extension reads WhatsApp's internal store and sends messages on your behalf.
- This is not an official WhatsApp integration and may conflict with WhatsApp's terms of service.
- Use it only with your own account and at your own risk.
- The reply persona presents itself as a human named John and denies being an AI. Depending on where you operate, that may have legal or ethical implications. Consider disclosing automated replies where required.

### Functional limitations

- Auto-reply works only in 1-on-1 chats. Groups are log-only.
- Auto-reply requires the extension, WhatsApp Web and the server to all be running.
- The 7-second burst and 15-second deadline mean very slow model responses fall back to canned lines.
- Videos are not downloaded or sent to Gemini; only the text marker is used.
- Files over 15 MB are acknowledged but not analyzed.
- Only the first open WhatsApp Web tab receives dashboard commands.
- The `filter` parameter on `/api/chat-history` is not applied by the extension; filtering happens in the dashboard.
- Counting and search rely on keyword rules, so unusual phrasing may be classified as unrelated.
- The server loads the full 3.2 MB dataset into memory at startup.
- No automated tests, no CI configuration, and no build step are included.
