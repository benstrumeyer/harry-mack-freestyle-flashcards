import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SongAnalysisPage from './SongAnalysisPage'
import type { VideoAnalysisDto } from '../services/api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const analysis: VideoAnalysisDto = {
  video: { id: 'vjb7TegEIYs', title: 'HM Freestyle', artist: 'harry_mack', barCount: 2, wordCount: 4, density: 0.5 },
  words: [
    { wordIndex: 0, text: 'i', start: 0.0, end: 0.1, score: 1, ipa: null, vowelSeq: null, deliveredIpa: null },
    { wordIndex: 1, text: 'explore', start: 0.1, end: 0.5, score: 1, ipa: 'ɛksplɔːɹ', vowelSeq: ['ɛ', 'ɔː'], deliveredIpa: 'or' },
    { wordIndex: 2, text: 'give', start: 1.0, end: 1.2, score: 1, ipa: null, vowelSeq: null, deliveredIpa: null },
    { wordIndex: 3, text: 'more', start: 1.2, end: 1.5, score: 1, ipa: 'mɔːɹ', vowelSeq: ['ɔː'], deliveredIpa: 'or' },
  ],
  events: [
    { wordIndex: 1, barIndex: 0, intraBarIndex: 1, canonicalKey: 'o@', deliveredKey: 'or', detector: 'perfect-end', groupIndex: 0, stress: 1 },
    { wordIndex: 3, barIndex: 1, intraBarIndex: 1, canonicalKey: 'o@', deliveredKey: 'or', detector: 'perfect-end', groupIndex: 0, stress: 1 },
  ],
  groups: [{ groupIndex: 0, hue: 120, size: 2, key: 'o@' }],
  scheme: { 0: 'AABB', 1: 'AABB' },
  density: 0.5,
}

function mockFetch(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response),
  )
}

describe('SongAnalysisPage', () => {
  it('renders the annotated transcript from the mocked api', async () => {
    mockFetch(analysis)
    render(
      <MemoryRouter initialEntries={['/songs/vjb7TegEIYs']}>
        <Routes>
          <Route path="/songs/:videoId" element={<SongAnalysisPage />} />
        </Routes>
      </MemoryRouter>,
    )

    // Transcript words appear once the analysis resolves.
    expect(await screen.findByText('explore')).toBeTruthy()
    expect(await screen.findByText('more')).toBeTruthy()

    // A bar carries a YouTube timestamp deep-link.
    const links = screen.getAllByRole('link') as HTMLAnchorElement[]
    const ytLink = links.find((a) => a.href.includes('watch?v=vjb7TegEIYs'))
    expect(ytLink).toBeTruthy()
    expect(ytLink!.href).toContain('t=')
  })
})
