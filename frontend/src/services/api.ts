const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path}: ${res.status}`)
}

export interface OpenerDto {
  id: string
  text: string
  frequency: number
  exampleCompletions: string[]
}

export interface SavedOpenerDto {
  id: string
  openerId: string | null
  text: string
  savedAt: string
}

export interface RhymeWordDto {
  id: string
  word: string
  phonemes: string | null
  frequency: number
}

export interface RhymePairDto {
  wordA: string
  wordB: string
  frequency: number
}

export interface RhymeMapDto {
  nodes: RhymeWordDto[]
  edges: RhymePairDto[]
}

export interface RhymeDetailDto {
  word: RhymeWordDto
  rhymes: RhymeWordDto[]
}

export interface VideoStatusDto {
  id: string
  title: string | null
  source: string
  filename: string | null
  url: string | null
  processedAt: string
  barCount: number
}

export interface SessionDto {
  id: string
  startedAt: string
  cardsShown: string[]
}

export interface PipelineResultDto {
  message: string
  barsExtracted: number
  openersFound: number
  rhymeWordsFound: number
}

export interface PlaylistQueuedDto {
  message: string
  videoCount: number
}

export interface BarSourceDto {
  videoTitle: string | null
  videoUrl: string | null
  youtubeId: string | null
  timestampSeconds: number | null
  barText: string
}

// --- Rap analysis (annotated transcript) ---
// Mirror the backend response DTOs (Models/AnalysisDtos.cs), served camelCase.

export interface VideoSummaryDto {
  id: string
  title: string | null
  artist: string | null
  barCount: number
  wordCount: number
  density: number | null
}

export interface TranscriptWordDto {
  wordIndex: number
  text: string
  start: number
  end: number
  score: number | null
  ipa: string | null
  vowelSeq: string[] | null
  deliveredIpa: string | null
}

// Persisted rhyme event (backend AnalysisEventDto) — carries the group link + detector label.
export interface RhymeEventDto {
  wordIndex: number
  barIndex: number
  intraBarIndex: number
  canonicalKey: string | null
  deliveredKey: string | null
  detector: string | null
  groupIndex: number | null
  stress: number
}

// Persisted rhyme group (backend AnalysisGroupDto) — hue drives transcript coloring.
export interface RhymeGroupDto {
  groupIndex: number
  hue: number
  size: number
  key: string | null
}

export interface VideoAnalysisDto {
  video: VideoSummaryDto
  words: TranscriptWordDto[]
  events: RhymeEventDto[]
  groups: RhymeGroupDto[]
  scheme: Record<number, string>
  density: number
}

// Per-song rhyme dictionary (backend SongDictionaryDto).
export interface SongDictionaryGroupDto {
  groupIndex: number
  hue: number
  key: string | null
  words: string[]
}

export interface SongDictionaryDto {
  videoId: string
  groups: SongDictionaryGroupDto[]
}

// --- Rhyme Game opener mode (mirror backend Models/OpenerModeDtos.cs, camelCase) ---

export interface OpenerChallengeDto {
  openerId: string
  openerText: string
  targetWord: string | null
  targetKey: string | null
  targetDeliveredKey: string | null
  validWords: string[]
}

// matchedOn ∈ "canonical" | "delivered" | "dictionary" | null
export interface OpenerValidationDto {
  valid: boolean
  word: string
  key: string | null
  targetKey: string | null
  matchedOn: string | null
}

export const api = {
  processUrl: (url: string, artist = 'harry_mack') =>
    post<PipelineResultDto>('/pipeline/process-url', { url, artist }),
  processPlaylist: (url: string) =>
    post<PlaylistQueuedDto>('/pipeline/process-playlist', { url }),
  getPipelineStatus: () =>
    get<VideoStatusDto[]>('/pipeline/status'),
  validateRhymes: () =>
    post<{ message: string; removed: number; total: number }>('/pipeline/validate-rhymes'),

  getOpeners: (search?: string) =>
    get<OpenerDto[]>(`/openers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getRandomOpener: () =>
    get<OpenerDto>('/openers/random'),
  getOpenerSources: (id: string) =>
    get<BarSourceDto[]>(`/openers/${id}/sources`),
  deleteOpener: (id: string) =>
    del(`/openers/${id}`),

  getSavedOpeners: () =>
    get<SavedOpenerDto[]>('/saved'),
  saveOpener: (openerId: string, text: string) =>
    post<SavedOpenerDto>('/saved', { openerId, text }),
  unsaveOpener: (id: string) =>
    del(`/saved/${id}`),
  updateSavedOpener: (id: string, text: string) =>
    patch<SavedOpenerDto>(`/saved/${id}`, { text }),

  getRhymes: () =>
    get<RhymeWordDto[]>('/rhymes'),
  getRhymeDetail: (word: string) =>
    get<RhymeDetailDto>(`/rhymes/${encodeURIComponent(word)}`),
  getRhymeMap: () =>
    get<RhymeMapDto>('/rhymes/map'),
  getRhymeSources: (word: string) =>
    get<BarSourceDto[]>(`/rhymes/${encodeURIComponent(word)}/sources`),

  createSession: (cardsShown: string[]) =>
    post<SessionDto>('/sessions', { cardsShown }),
  getSessions: () =>
    get<SessionDto[]>('/sessions'),

  getWordList: (artist = 'harry_mack') =>
    get<{ words: [string, number, string, number][]; openers: string[] }>(`/game/wordlist/${artist}`),

  getVideos: () =>
    get<VideoSummaryDto[]>('/videos'),
  getVideoAnalysis: (id: string) =>
    get<VideoAnalysisDto>(`/videos/${encodeURIComponent(id)}/analysis`),
  getSongDictionary: (id: string) =>
    get<SongDictionaryDto>(`/videos/${encodeURIComponent(id)}/rhyme-dictionary`),

  // --- Rhyme Game opener mode (spec §7b / Spec 2, Task 5.1 backend) ---
  getOpenerChallenge: (openerId: string) =>
    get<OpenerChallengeDto>(`/game/opener/${encodeURIComponent(openerId)}`),
  validateOpenerGuess: (openerId: string, word: string) =>
    post<OpenerValidationDto>(`/game/opener/${encodeURIComponent(openerId)}/validate`, { word }),
}
