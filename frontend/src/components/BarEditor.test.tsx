import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import BarEditor from './BarEditor'
import { api } from '../services/api'
import type { VideoAnalysisDto, UserAnnotationDto } from '../services/api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Minimal analysis: four words in one auto-split bar, each with a phonetic key.
const analysis: VideoAnalysisDto = {
  video: { id: 'v1', title: 'HM', artist: 'harry_mack', barCount: 1, wordCount: 4, density: 0.5, youtubeId: 'v1' },
  words: [
    { wordIndex: 0, text: 'i', start: 0.0, end: 0.1, score: 1, ipa: null, vowelSeq: null, deliveredIpa: null },
    { wordIndex: 1, text: 'explore', start: 0.1, end: 0.3, score: 1, ipa: null, vowelSeq: null, deliveredIpa: null },
    { wordIndex: 2, text: 'the', start: 0.3, end: 0.4, score: 1, ipa: null, vowelSeq: null, deliveredIpa: null },
    { wordIndex: 3, text: 'shore', start: 0.4, end: 0.6, score: 1, ipa: null, vowelSeq: null, deliveredIpa: null },
  ],
  events: [
    { wordIndex: 1, barIndex: 0, intraBarIndex: 1, canonicalKey: 'o@', deliveredKey: 'or', detector: 'perfect-end', groupIndex: 0, stress: 1 },
    { wordIndex: 3, barIndex: 0, intraBarIndex: 3, canonicalKey: 'o@', deliveredKey: 'or', detector: 'perfect-end', groupIndex: 0, stress: 1 },
  ],
  groups: [],
  scheme: {},
  density: 0.5,
}

describe('BarEditor auto-annotate', () => {
  it('renders an Auto-annotate control with a Local / Ensemble / AI draft engine picker', async () => {
    vi.spyOn(api, 'getAnnotation').mockResolvedValue(null)

    render(<BarEditor analysis={analysis} videoId="v1" />)

    // control + engine options exist
    expect(await screen.findByRole('button', { name: /auto-annotate/i })).toBeTruthy()
    const picker = screen.getByLabelText(/auto-annotate engine/i) as HTMLSelectElement
    const optionLabels = Array.from(picker.options).map((o) => o.textContent)
    expect(optionLabels).toEqual(['Local', 'Ensemble', 'AI draft'])
  })

  it('fetches the ensemble draft, pre-fills rhyme groups as editable suggestions, and enables Save', async () => {
    vi.spyOn(api, 'getAnnotation').mockResolvedValue(null)
    const draft: UserAnnotationDto = { bars: [], groups: { 'o@': [1, 3] }, paras: [], types: {} }
    const getAuto = vi.spyOn(api, 'getAutoAnnotate').mockResolvedValue(draft)

    render(<BarEditor analysis={analysis} videoId="v1" />)
    await screen.findByRole('button', { name: /auto-annotate/i })

    // Save starts disabled (nothing dirty yet).
    const save = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /auto-annotate/i }))

    await waitFor(() => expect(getAuto).toHaveBeenCalledWith('v1', 'ensemble'))
    // Both grouped words are painted into family "A" (subscript letter).
    await waitFor(() => expect(screen.getAllByText('A').length).toBe(2))
    // Suggestion is editable + unsaved: Save is now enabled.
    expect((screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('uses the selected AI draft engine and pre-fills bars + opener types from the draft', async () => {
    vi.spyOn(api, 'getAnnotation').mockResolvedValue(null)
    const draft: UserAnnotationDto = {
      bars: [[0, 1], [2, 3]],
      groups: { 'o@': [1, 3] },
      paras: [],
      types: { '1': 'opener' },
    }
    const getAuto = vi.spyOn(api, 'getAutoAnnotate').mockResolvedValue(draft)

    render(<BarEditor analysis={analysis} videoId="v1" />)
    await screen.findByRole('button', { name: /auto-annotate/i })

    fireEvent.change(screen.getByLabelText(/auto-annotate engine/i), { target: { value: 'ai' } })
    fireEvent.click(screen.getByRole('button', { name: /auto-annotate/i }))

    await waitFor(() => expect(getAuto).toHaveBeenCalledWith('v1', 'ai'))
    // Draft bars applied: two bar rows now render two start timestamps.
    await waitFor(() => expect(screen.getAllByText('0:00').length).toBeGreaterThanOrEqual(1))
    expect(screen.getAllByText('A').length).toBe(2)
  })

  it('returns gracefully when the AI draft engine has no stored draft', async () => {
    vi.spyOn(api, 'getAnnotation').mockResolvedValue(null)
    const getAuto = vi.spyOn(api, 'getAutoAnnotate').mockResolvedValue(null)

    render(<BarEditor analysis={analysis} videoId="v1" />)
    await screen.findByRole('button', { name: /auto-annotate/i })

    fireEvent.change(screen.getByLabelText(/auto-annotate engine/i), { target: { value: 'ai' } })
    fireEvent.click(screen.getByRole('button', { name: /auto-annotate/i }))

    await waitFor(() => expect(getAuto).toHaveBeenCalledWith('v1', 'ai'))
    // No draft: nothing painted, Save stays disabled.
    expect(screen.queryAllByText('A').length).toBe(0)
    expect((screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})
