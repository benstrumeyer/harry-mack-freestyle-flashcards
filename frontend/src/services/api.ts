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
}
