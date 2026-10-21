# Turabees Dataset

This folder powers the Turabees-only reply behaviour of the WhatsApp bot.

## Source

- Workbook: `fabrics.xlsx` (analyzed from `C:\Users\admin\Downloads\fabrics.xlsx` on 2026-10-20).
- Profile sources: official Turabees pages `www.turabees.com`, `/collections`, `/bespoke`, `/contact`.

## Files

- `fabrics.json` — normalized rows from every workbook sheet.
- `turabees-profile.md` — brand, collections, bespoke process, service and contact facts.
- `README.md` — this file.

## Sheet inventory

| Sheet | Non-empty data rows |
|---|---:|
| `fabrics.csv` | 3,603 |
| `suit fabrics` | 3,612 |
| `Final 90 fabrics` | 112 |
| `Final Sehrwani fabrics` | 218 |
| `accessories` | 2 |
| `Image generation pipeline` | 49 |
| `Sheet6` | 1 |
| **All sheets** | **7,597** |

The four fabric sheets contain 7,545 rows and 3,831 unique catalog codes.

## What the bot does with it

- The bot is **John**, a human-sounding member of the Turabees team. It chats normally, jokes around and can do light gossip in DMs.
- Replies match the language/script of the newest DM (English, Roman Urdu or Urdu), even if earlier messages used a different language. Explicit language requests override this.
- Respected/formal contacts are addressed with **“sir”** instead of “yaar”.
- Turabees / fabric questions get the profile, exact sheet counts, and the most relevant dataset rows.
- Unrelated questions get a short, human steer-back to Turabees/fabrics instead of an unrelated answer.
- Personal details shared earlier in the chat (name, wedding date, preferences, previous messages) are answered from the contact details and rolling chat memory.
- Attachments (images, audio/voice notes, PDF, DOCX, XLSX, PPTX, CSV/text) are inspected by the model. Related files are answered; unrelated file contents are not analyzed, and John sends a short steer-back.
- The bot corrects common misspellings of Turabees and never invents counts, prices or availability.

## Timing

- 7-second WhatsApp burst, then generation.
- Accuracy is the priority: the model is allowed to finish (typical replies are 1–3 seconds).
- A 15-second safety ceiling exists only to prevent a hung request.
- The fallback line is used only when every API key fails/is rate-limited or the safety ceiling is hit.
- PDF text is extracted locally so large documents do not slow down generation.
