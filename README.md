# CV Agent

An AI CV editor that tailors resumes to job descriptions using evidence from your projects, with change-by-change approval, feedback, and ATS compatibility checks.

## What works now

- Import a text-based PDF, DOCX, TXT, or Markdown CV, or paste CV text. Uploaded PDFs are previewed directly from the original file in the browser, without recreating their styling. DOCX files retain their actual OOXML package; the app presents a clearly marked text-only wording view and a download of the original file rather than a misleading imitation of Word layout.
- Import a public HTTPS job URL from any website, or paste its description. Known Greenhouse, Lever, and Ashby links use their public APIs; other pages use Jina Reader. Login walls and blocked pages require pasted text.
- Research the company homepage and up to seven relevant linked pages, inspect the sources, and get cited company insights with AI analysis.
- Import public GitHub READMEs (one repository, or up to three recently updated non-fork repositories from a profile).
- Add project ZIPs, READMEs, and supporting documents. Read selected text files without executing uploaded code.
- Run non-AI review checks and concrete evidence questions without an API key. These comments are clearly labeled and do not rewrite the CV.
- Verify your own Groq API key, then generate role-specific AI suggestions with exact job requirements, source excerpts, and selective comment-based revisions.
- Accept or reject individual edits, edit proposed wording, inspect source excerpts, and undo decisions.
- Export approved wording in the original DOCX package, or download an unchanged uploaded PDF in its original layout. Text-only CVs can be exported as newly laid-out DOCX/PDF files. Download the reviewed text or review history as JSON.

An uploaded PDF is displayed directly as its original file; no reconstruction is performed in the review. PDF text changes cannot reliably be applied in-place without affecting complex layouts, and the app now blocks a style-changing edited-PDF export. To apply edits while retaining typography and layout, provide the source DOCX. DOCX exports patch the original OOXML package and retain its layout/style structure, though replacement text may naturally reflow lines or pages. To obtain a PDF from an edited Word file, open the downloaded DOCX in Word or Google Docs and export it from there. The browser does not reproduce Word's full page layout, so DOCX review text is explicitly labeled text-only. Text-only CVs use a compact neutral layout. There is no universal ATS pass score; the keyword panel is a limited technical-term scan, not a prediction of hiring outcomes.

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

Without a saved server key, the initial state is **AI not connected**. An owner-private deployment may configure `GROQ_API_KEY` as a runtime secret. On opening, the browser tests that saved connection with synthetic data; the secret itself is never returned to the browser. A key entered in settings overrides it for that session. Open **AI settings**, enter a Groq key, and select **Test and connect**. Connection testing makes a small real generation request with synthetic data using the same model, parameters, and JSON schema as the review. It uses Groq quota and must return the expected structured response before showing AI as ready. Generate suggestions then makes a real Groq inference request; review checks are a separate action with no LLM calls. The key is kept only in tab memory, sent to the analysis endpoint per request, and never saved to a database or browser storage by this app.

The adapter calls Groq's OpenAI-compatible chat completions endpoint with `openai/gpt-oss-20b` and strict JSON-schema output. Using an OpenAI-named open model through Groq does not require an OpenAI API key. Use a Groq free-plan account if you want to avoid paid inference. Free quotas and model availability are controlled by Groq; this app cannot enforce your provider's billing settings. It does not upgrade plans or fall back to another provider. An empty, truncated, malformed, or entirely unverifiable review gets at most one repair request to the same model; all requests use your quota. Reviews containing edits also use a separate factual-verification request. Authentication, quota, rate-limit, network, and provider errors are not automatically retried. Quota errors are displayed; keyword checks remain available.

Provider requests and response validation are covered by mocked integration tests. The connection and full review pipeline were tested with a user-supplied Groq key and synthetic CV data. These checks do not guarantee semantic correctness for every CV.

## Grounding and review

The model returns proposals, not a replacement document. The server validates the response shape, original text, block IDs, unique targets, exact source excerpts, known technical-skill mentions, and numeric claims. Before showing edits, a separate AI verification request checks every proposed claim against the original line and exact cited excerpts, without using job or company text as proof. Unsupported details become clarification comments. A failed verification blocks the review. An invalid response is blocked. These checks do **not** prove semantic accuracy or project authorship; the user still reviews every claim. A repository's capabilities are not assumed to be the user's personal contribution.

Accepted edits replace only their target line. Undo restores that line. Stale proposals cannot overwrite manually changed text. Revising a suggestion sends that suggestion and the comment with the existing sources and asks for one replacement; other suggestions remain unchanged. Repeated analysis keeps the review history and suppresses already accepted, rejected, or pending targets. Cosmetic whitespace and capitalization edits are blocked. Each proposed edit is checked independently: an unverifiable edit does not discard the rest of the review. Job-requirement quotes tolerate whitespace/case differences. A valid completed review always includes supported suggestions or useful comments. If the provider request fails, the UI displays a specific safe error and a retry button, preserving the previous review. It never substitutes non-AI comments for a failed or empty AI review. Non-AI checks run only when explicitly selected. The model is asked for substantial changes and may return none. Job and company text can establish relevance, but cannot establish a candidate’s experience.

## Data handling and boundaries

- Document extraction takes place in the browser; original files are not uploaded to application storage.
- The editing session is temporary. Refreshing or closing the page loses unsaved work. Download exports and review history before leaving.
- Keyword checks do not send CV text to an LLM. Public web reading sends job/company URLs to Jina Reader through a fixed endpoint; CV files are not sent to that reader. Known job boards and GitHub imports use their public APIs.
- In Groq mode, extracted CV text, job text, project evidence, and comments are sent through the application endpoint to Groq. Candidate edits and their source excerpts are also sent for factual verification. Check the provider's current data terms before using identifiable documents.
- ZIP imports are limited to 10 MB compressed, 3,000 entries, 12 selected text sources, and 25,000 extracted characters. Large entries are streamed with a character cap, dependency/build directories and common secret-file names are skipped, and obvious tokens are redacted. Secret detection is best effort: inspect your inputs first. Uploaded code is never executed or extracted to disk.
- Job imports accept general public HTTPS websites. Private/local addresses, embedded credentials, and custom ports are rejected. General URLs are read through Jina Reader rather than fetched directly from the application network. Reader availability and rate limits may affect imports. Company research covers linked official pages, not an exhaustive search of the entire web.
- GitHub imports support public READMEs only, not private repositories or full-code retrieval. Public API rate limits may apply.
- Scanned-image PDFs need pasted text; OCR is not implemented. Complex multi-column PDFs may extract out of order. Check and edit extracted text before analysis.
- Unchanged source PDFs download verbatim with no app title, page URL, timestamp, or review annotations. DOCX uploads export through OOXML text patches rather than PDF re-layout. For text-only CV input, new PDFs use embedded serif, sans and mono fonts covering Latin, Greek and Cyrillic; unavailable glyphs generate an explicit error. Review pagination before sending.
- There are no accounts, durable CV storage, or cross-device history in this version.
- The private hosted preview is owner-only. A future public deployment needs stronger abuse controls before adding any shared provider credential; this version uses each user's own key.

## Architecture

| Layer | Files |
| --- | --- |
| Upload, original PDF preview, Word source handling, review, export | `components/workspace.tsx` |
| CV blocks, keywords, edit validation, review history, decisions | `lib/cv.ts` |
| PDF/DOCX/ZIP extraction, positioned PDF text, token redaction | `lib/import.ts`, `lib/pdf-text.ts` |
| Imported style inference and direct PDF / DOCX exports | `lib/cv-style.ts`, `lib/export.ts` |
| Public pages, company sources, relevant passage selection | `lib/web-research.ts`, `lib/retrieval.ts` |
| Bounded requests and public source fetching | `lib/api.ts` |
| Shared Groq adapter and review schema | `lib/groq.ts`, `lib/ai-review-schema.ts`, `lib/verify-review.ts` |
| Groq analysis and single-suggestion revisions | `app/api/analyze/route.ts` |
| General job links, job board and GitHub README imports | `app/api/import/route.ts` |
| Company research and AI connection verification | `app/api/research/route.ts`, `app/api/ai-status/route.ts` |
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
- [Jina Reader](https://github.com/jina-ai/reader)
- [PDF-LIB](https://pdf-lib.js.org/)
- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever public Postings API](https://github.com/lever/postings-api)
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)

This project is an early working prototype, not a guarantee of ATS compatibility or an employment outcome.
