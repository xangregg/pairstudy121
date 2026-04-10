# Running This Study on Prolific

## Overview

The app supports Prolific integration via URL parameters.
Prolific automatically appends participant identifiers to the study URL;
the app reads these and stores them alongside each session.

---

## Setting Up the Study URL

When creating your Prolific study, set the study URL to:

```
https://<your-deployment-url>/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}&pg=<encoded-completion-code>
```

Prolific replaces `{{%PROLIFIC_PID%}}`, `{{%STUDY_ID%}}`, and `{{%SESSION_ID%}}`
with real values when a participant clicks the link.

---

## Completion Code Parameter (`pg`)

The completion code is passed via the `pg` URL parameter.
It is Base64-encoded so it is not immediately recognizable to participants
in the browser address bar.

**To encode your completion code:**

1. Open any browser console (F12 → Console).
2. Run: `btoa("YOUR_COMPLETION_CODE")`
3. Copy the output and append it to the study URL as `&pg=<output>`.

**Example:**

```
btoa("CXAMPLE123")  →  "Q1hBTVBMRTEyMw=="
```

Study URL:
```
https://example.com/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}&pg=Q1hBTVBMRTEyMw==
```

---

## Completion URL (on Prolific)

In your Prolific study settings, set the completion URL to:

```
https://app.prolific.com/submissions/complete?cc=YOUR_COMPLETION_CODE
```

Use the **plain** (non-encoded) code here — this is Prolific's own field, not the survey URL.

The app will show a **Return to Prolific** button on the final page that links to this URL automatically.
The button only appears when `PROLIFIC_PID` is present in the survey URL.

---

## What Gets Recorded

The following Prolific fields are stored in the `sessions` table alongside each participant's data:

| DB column | Source |
|---|---|
| `participant_id` | `PROLIFIC_PID` (used as the primary participant identifier) |
| `prolific_pid` | `PROLIFIC_PID` (also stored explicitly for clarity) |
| `prolific_study_id` | `STUDY_ID` |
| `prolific_session_id` | `SESSION_ID` |
| `participant_group` | Decoded completion code (from `pg`); used to separate Prolific runs |

---

## Testing Locally

To test the Prolific flow without going through Prolific,
manually add the parameters to the URL:

```
http://localhost/?PROLIFIC_PID=test123&STUDY_ID=study456&SESSION_ID=sess789&pg=<encoded-code>
```

Note: browser address bar autocomplete may rewrite uppercase parameter names to lowercase.
The app accepts both cases (`PROLIFIC_PID` and `prolific_pid`, etc.).

---

## Supabase Schema

Run these migrations before launching a Prolific study if not already applied:

```sql
ALTER TABLE sessions ADD COLUMN prolific_pid        text;
ALTER TABLE sessions ADD COLUMN prolific_study_id   text;
ALTER TABLE sessions ADD COLUMN prolific_session_id text;
```
