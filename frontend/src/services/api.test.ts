import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import type { VideoAnalysisDto, VideoSummaryDto, SongDictionaryDto } from './api'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchOnce(payload: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }) as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('api.getVideos', () => {
  it('GETs /api/videos and returns typed summaries', async () => {
    const payload: VideoSummaryDto[] = [
      { id: 'vjb7TegEIYs', title: 'HM', artist: 'harry_mack', barCount: 12, wordCount: 80, density: 0.42, youtubeId: 'vjb7TegEIYs' },
    ]
    const fetchMock = mockFetchOnce(payload)
    const res = await api.getVideos()
    expect(fetchMock).toHaveBeenCalledWith('/api/videos')
    expect(res[0].id).toBe('vjb7TegEIYs')
    expect(res[0].density).toBe(0.42)
  })
})

describe('api.getVideoAnalysis', () => {
  it('GETs /api/videos/:id/analysis and returns a typed VideoAnalysisDto', async () => {
    const payload: VideoAnalysisDto = {
      video: { id: 'v1', title: 'HM', artist: 'harry_mack', barCount: 2, wordCount: 4, density: 0.5, youtubeId: 'v1' },
      words: [
        { wordIndex: 1, text: 'explore', start: 0.1, end: 0.5, score: 1.0, ipa: 'ɛksplɔːɹ', vowelSeq: ['ɛ', 'ɔː'], deliveredIpa: 'or' },
      ],
      events: [
        { wordIndex: 1, barIndex: 0, intraBarIndex: 1, canonicalKey: 'o@', deliveredKey: 'or', detector: 'perfect-end', groupIndex: 0, stress: 1 },
      ],
      groups: [
        { groupIndex: 0, hue: 120, size: 2, key: 'o@' },
      ],
      scheme: { 0: 'AABB' },
      density: 0.5,
    }
    const fetchMock = mockFetchOnce(payload)
    const res = await api.getVideoAnalysis('v1')
    expect(fetchMock).toHaveBeenCalledWith('/api/videos/v1/analysis')
    expect(res.video.id).toBe('v1')
    expect(res.words[0].text).toBe('explore')
    expect(res.events[0].detector).toBe('perfect-end')
    expect(res.groups[0].hue).toBe(120)
    expect(res.scheme[0]).toBe('AABB')
  })

  it('URL-encodes the video id', async () => {
    const fetchMock = mockFetchOnce({})
    await api.getVideoAnalysis('a/b')
    expect(fetchMock).toHaveBeenCalledWith('/api/videos/a%2Fb/analysis')
  })
})

describe('api.getSongDictionary', () => {
  it('GETs /api/videos/:id/rhyme-dictionary and returns a typed SongDictionaryDto', async () => {
    const payload: SongDictionaryDto = {
      videoId: 'v1',
      groups: [{ groupIndex: 0, hue: 120, key: 'o@', words: ['explore', 'more'] }],
    }
    const fetchMock = mockFetchOnce(payload)
    const res = await api.getSongDictionary('v1')
    expect(fetchMock).toHaveBeenCalledWith('/api/videos/v1/rhyme-dictionary')
    expect(res.groups[0].words).toContain('more')
  })
})
