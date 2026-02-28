# Shipping Decisions

> Populated by the implementing agent. Reviewed by the code reviewer instance before shipping.
> Status: **REVIEWED — all blockers fixed, cleared for docker compose up**

---

## Decisions Made During Implementation

### Backend

#### D1 — OpenAI SDK v2.x API surface
Used `OpenAIClient.GetChatClient("gpt-4o-mini")` → `ChatClient`. `CompleteChatAsync` returns `ChatCompletion`. Content accessed via `completion.Content[0].Text`.
- **Risk**: API surface varies across minor versions of `OpenAI` NuGet 2.x. If `Content[0]` throws on empty responses we'll get a runtime crash.

#### D2 — No EF Core, raw Npgsql
All DB access uses `NpgsqlDataSource` (singleton) + `OpenConnectionAsync()` per request. Minimal overhead, no ORM magic.

#### D3 — PipelineService registered as Scoped
`PipelineService` takes `NpgsqlDataSource` (singleton) and `LlmExtractor`/`TranscriptParser` (singletons). Scoped is fine since it opens its own connection on demand.

#### D4 — Transcript blank-line = end of freestyle section
`TranscriptParser.ParseLocalTxt` ends a `[FREESTYLE]` section on blank lines. This is based on the real `ZjAkTBoLxt8.txt` file format. Risk: if a transcript has intentional blank lines mid-section, bars will be split into multiple sections (which is OK — each will still be sent to the LLM).

#### D5 — LLM batch size = 25 lines
Batches of 25 lines per OpenAI call. This avoids context window issues with gpt-4o-mini while keeping cost reasonable.

#### D6 — Rhyme pair canonical order: alphabetical word_a < word_b
Prevents duplicate (a,b) vs (b,a) pairs. Enforced by `string.Compare` before INSERT.

#### D7 — yt-dlp output template `/tmp/{id}.%(ext)s`
yt-dlp may produce `.en.vtt` or `.en-US.vtt`. Code searches `/tmp/{youtubeId}*.vtt` to find it.
- **Risk**: if yt-dlp binary isn't found in PATH inside the container, `ProcessUrlAsync` throws `InvalidOperationException`. The Dockerfile installs yt-dlp to `/usr/local/bin/yt-dlp`.

#### D8 — CORS: AllowAnyOrigin in dev
`AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()` is intentionally permissive for this local dev tool. No production deploy is planned.

---

### Frontend

#### D9 — Tailwind v4 with `@tailwindcss/vite` plugin
Package.json has `tailwindcss: ^4.2.1` and `@tailwindcss/vite: ^4.2.1` in devDeps. `index.css` uses `@import "tailwindcss"`. No `tailwind.config.js` required.
- **Note**: `tailwindcss` as a devDep was already present (user added it). Added `@tailwindcss/vite` plugin which is mandatory for the v4 Vite workflow.

#### D10 — d3-force only (not full d3 bundle)
`d3-force` installed as a runtime dependency. `WordMap.tsx` imports from `d3-force` only. SVG elements rendered via React state (positions updated on each tick). No direct DOM manipulation.
- **Risk**: The simulation ticks fast (~300 ticks before cooling). Setting state on every tick causes many re-renders. Acceptable for a visualization tool, not a main UI path.

#### D11 — API proxy target uses Docker service name `backend:8080`
`vite.config.ts` proxies `/api` → `http://backend:8080`. This works only when running inside Docker Compose where `backend` resolves. For local dev outside Docker, users need to change the target to `http://localhost:5000`.
- **Flagged**: This could cause confusion for developers running the frontend locally.

#### D12 — Session save on component unmount
`FlashcardPage` saves the session in a `useEffect` cleanup function. Because React 18+ strict mode double-invokes effects in development, the session save might fire twice in dev mode (with an empty array on the first cleanup). The check `sessionCards.current.length > 0` prevents saving empty sessions.

#### D13 — `@types/react-router-dom` version mismatch
`package.json` has `@types/react-router-dom: ^5.3.3` as a dependency (not devDep). React Router v7 ships its own types — this old `@types` package is a leftover from scaffolding and may cause type conflicts.
- **Action needed**: Remove `@types/react-router-dom` from dependencies.

#### D14 — No error boundaries
None of the pages have React error boundaries. A failing API call surfaces as an error state in local `catch` blocks, but unhandled errors in render will crash the page. Acceptable for an internal tool.

---

## Files Changed / Created

| File | Action |
|------|--------|
| `backend/HarryMack.Api/Program.cs` | Rewritten |
| `backend/HarryMack.Api/Models/RawLine.cs` | Created |
| `backend/HarryMack.Api/Models/ExtractedBar.cs` | Created |
| `backend/HarryMack.Api/Models/Dtos.cs` | Created |
| `backend/HarryMack.Api/Services/TranscriptParser.cs` | Created |
| `backend/HarryMack.Api/Services/LlmExtractor.cs` | Created |
| `backend/HarryMack.Api/Services/PipelineService.cs` | Created |
| `backend/HarryMack.Api/Controllers/PipelineController.cs` | Created |
| `backend/HarryMack.Api/Controllers/OpenersController.cs` | Created |
| `backend/HarryMack.Api/Controllers/RhymesController.cs` | Created |
| `backend/HarryMack.Api/Controllers/SessionsController.cs` | Created |
| `frontend/index.html` | Title updated |
| `frontend/package.json` | Name + d3-force + @tailwindcss/vite added |
| `frontend/vite.config.ts` | Tailwind plugin + API proxy added |
| `frontend/src/index.css` | Replaced with Tailwind v4 + dark theme |
| `frontend/src/App.tsx` | Replaced with React Router + nav |
| `frontend/src/main.tsx` | Already clean, no changes needed |
| `frontend/src/services/api.ts` | Created |
| `frontend/src/pages/FlashcardPage.tsx` | Created |
| `frontend/src/pages/OpenerDictionaryPage.tsx` | Created |
| `frontend/src/pages/RhymeDictionaryPage.tsx` | Created |
| `frontend/src/pages/PipelinePage.tsx` | Created |
| `frontend/src/components/WordMap.tsx` | Created |
| `frontend/src/components/HistoryModal.tsx` | Created |

## Open Questions for Reviewer

1. Is D11 acceptable (proxy only works in Docker)? Should we add a `.env.development` fallback?
2. D13 — confirm `@types/react-router-dom` should be removed to avoid type conflicts.
3. The `WordMap` re-renders on every simulation tick. Is this acceptable or should we use `useRef` for the SVG and update DOM directly?
