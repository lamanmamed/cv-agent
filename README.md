# CV Agent

An AI CV editor that tailors resumes to job descriptions using evidence from your projects, with change-by-change approval, feedback, and ATS compatibility checks.

## What works now

- Import a text-based PDF, DOCX, TXT, or Markdown CV, or paste CV text.
- Paste a job description or import a public Greenhouse, Lever, or Ashby job URL.
- Import public GitHub READMEs (one repository, or up to three recently updated non-fork repositories from a profile).
- Add project ZIPs, READMEs, and supporting documents. Read selected text files without executing uploaded code.
- Use local mode for conservative wording edits and a technical keyword comparison without an API key.
- Enable Groq using your own API key for source-linked AI suggestions and selective comment-based revisions.
- Accept or reject individual edits, edit proposed wording, inspect source excerpts, and undo decisions.
- Export the approved CV as DOCX, plain text, or PDF via the browser's print dialog. Download the original text and review history as JSON.

The app uses a clean single-column export template rather than preserving arbitrary uploaded layouts. There is no universal ATS pass score; the keyword panel is a limited technical-term scan, not a prediction of hiring outcomes.

## Run locally

Requires Node.js 22.13+ and pnpm. The project uses React, TypeScript, Vinext/Vite, and Cloudflare-compatible route handlers.

```sh
git clone https://github.com/lamanmamed/cv-agent.git
cd cv-agent
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by the development server. The default portable profile is used outside the managed Sites editing environment. No environment variables are required. Postinstall copies the matching PDF.js worker into `public/`; it is generated and excluded from Git.

```sh
pnpm typecheck
pnpm test
pnpm build
```

## AI setup and costs

The default is **local mode**, with no LLM API calls. Open **AI settings**, enter a Groq key, and analyze a CV to enable AI mode. The key is kept only in tab memory, sent to the analysis endpoint per request, and never saved to a database or browser storage by this app.

The adapter calls Groq's OpenAI-compatible chat completions endpoint with `openai/gpt-oss-20b` and strict JSON-schema output. Using an OpenAI-named open model through Groq does not require an OpenAI API key. Use a Groq free-plan account if you want to avoid paid inference. Free quotas and model availability are controlled by Groq; this app cannot enforce your provider's billing settings. It does not silently upgrade plans, retry charged requests, or fall back to a paid provider. Quota errors are displayed so you can switch to local mode.

No live LLM request was tested in the initial implementation because no API key was supplied.

## Grounding and review

The model returns proposals, not a replacement document. The server validates the response shape, original text, block IDs, unique targets, exact source excerpts, known technical-skill mentions, and numeric claims. An invalid response is blocked. These checks do **not** prove semantic accuracy or project authorship; the user still reviews every claim. A repository's capabilities are not assumed to be the user's personal contribution.

Accepted edits replace only their target line. Undo restores that line. Stale proposals cannot overwrite manually changed text. Revising a suggestion sends that suggestion and the comment with the existing sources and asks for one replacement; other suggestions remain unchanged. Regenerating a complete analysis uses the current CV and replaces the previous review list, so save the review history first if you need to retain it.

## Data handling and boundaries

- Document extraction takes place in the browser; original files are not uploaded to application storage.
- The editing session is temporary. Refreshing or closing the page loses unsaved work. Download exports and review history before leaving.
- Local analysis does not send CV text to an LLM. Link imports send the entered link to the application endpoint and request public provider APIs.
- In Groq mode, extracted CV text, job text, project evidence, and comments are sent through the application endpoint to Groq. Check the provider's current data terms before using identifiable documents.
- ZIP imports are limited to 10 MB compressed, 3,000 entries, 12 selected text sources, and 25,000 extracted characters. Large entries are streamed with a character cap, dependency/build directories and common secret-file names are skipped, and obvious tokens are redacted. Secret detection is best effort: inspect your inputs first. Uploaded code is never executed or extracted to disk.
- Job imports use fixed public APIs for supported boards; arbitrary hosts, user credentials, ports, and redirects are rejected. Other job sites require pasting the description.
- GitHub imports support public READMEs only, not private repositories or full-code retrieval. Public API rate limits may apply.
- Scanned-image PDFs need pasted text; OCR is not implemented. Complex multi-column PDFs may extract out of order. Check and edit extracted text before analysis.
- Browser PDF output uses the print dialog; select **Save as PDF** and inspect pagination. Fonts are standard Arial and the original layout is replaced.
- There are no accounts, durable CV storage, or cross-device history in this version.
- The private hosted preview is owner-only. A future public deployment needs stronger abuse controls before adding any shared provider credential; this version uses each user's own key.

## Architecture

| Layer | Files |
| --- | --- |
| Upload, preview, review, export | `components/workspace.tsx` |
| CV blocks, keywords, local edits, citation checks, decisions | `lib/cv.ts` |
| PDF/DOCX/ZIP extraction and token redaction | `lib/import.ts` |
| Bounded requests and public source fetching | `lib/api.ts` |
| Groq analysis and single-suggestion revisions | `app/api/analyze/route.ts` |
| Job board and GitHub README imports | `app/api/import/route.ts` |
| Review/grounding/ZIP/request regression tests | `tests/core.test.ts` |

The site also exposes two browser WebMCP tools when the browser supports `document.modelContext`: read the current review, and apply an explicitly requested accept/reject/undo decision. Tools share the same state operations as the UI. Validation in a supported WebMCP browser was unavailable during initial development.

## Next development steps

1. Exercise AI suggestions and selective revisions with a free Groq key and a small non-identifiable CV.
2. Test real-world PDF/DOCX extraction, pagination, and accessibility in supported browsers.
3. Expand evidence retrieval beyond READMEs and link claims to explicit contribution records.
4. Add persistence with user authentication when saved applications are needed.

## Provider documentation

- [Groq structured output](https://console.groq.com/docs/structured-outputs)
- [Groq API keys](https://console.groq.com/keys)
- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever public Postings API](https://github.com/lever/postings-api)
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)

This project is an early working prototype, not a guarantee of ATS compatibility or an employment outcome.
