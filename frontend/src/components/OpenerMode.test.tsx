import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import OpenerMode from './OpenerMode'
import { api } from '../services/api'
import type { OpenerDto, OpenerChallengeDto, OpenerValidationDto } from '../services/api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const openers: OpenerDto[] = [
  { id: 'op1', text: 'Yo, check it out —', frequency: 3, exampleCompletions: [] },
  { id: 'op2', text: 'Off the top, no pause,', frequency: 2, exampleCompletions: [] },
]

const challenge: OpenerChallengeDto = {
  openerId: 'op1',
  openerText: 'Yo, check it out —',
  targetWord: 'fire',
  targetKey: 'aɪɚ',
  targetDeliveredKey: 'aɪ',
  validWords: ['higher', 'desire'],
}

describe('OpenerMode', () => {
  it('presents the opener and its target rhyme word from the challenge api', async () => {
    vi.spyOn(api, 'getOpeners').mockResolvedValue(openers)
    const getChallenge = vi.spyOn(api, 'getOpenerChallenge').mockResolvedValue(challenge)

    render(<OpenerMode />)

    expect(await screen.findByText(/Yo, check it out/)).toBeTruthy()
    expect(await screen.findByText('fire')).toBeTruthy()
    expect(getChallenge).toHaveBeenCalledWith('op1')
  })

  it('scores a valid rhyme and rejects an invalid one via the 5.1 validate endpoint', async () => {
    vi.spyOn(api, 'getOpeners').mockResolvedValue(openers)
    vi.spyOn(api, 'getOpenerChallenge').mockResolvedValue(challenge)
    const validate = vi
      .spyOn(api, 'validateOpenerGuess')
      .mockImplementation(
        async (_openerId: string, word: string): Promise<OpenerValidationDto> => ({
          valid: word === 'higher',
          word,
          key: word === 'higher' ? 'aɪɚ' : 'xx',
          targetKey: 'aɪɚ',
          matchedOn: word === 'higher' ? 'canonical' : null,
        }),
      )

    render(<OpenerMode />)
    await screen.findByText('fire')

    const input = screen.getByPlaceholderText(/rhyme/i) as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement

    // Valid guess is accepted and scored.
    fireEvent.change(input, { target: { value: 'higher' } })
    fireEvent.submit(form)
    await waitFor(() => expect(validate).toHaveBeenCalledWith('op1', 'higher'))
    expect(await screen.findByText('higher')).toBeTruthy()
    expect(await screen.findByText(/Score:\s*1/)).toBeTruthy()

    // Invalid guess is rejected and the score does not change.
    fireEvent.change(input, { target: { value: 'banana' } })
    fireEvent.submit(form)
    await waitFor(() => expect(validate).toHaveBeenCalledWith('op1', 'banana'))
    await waitFor(() => expect(screen.getByText(/Score:\s*1/)).toBeTruthy())
  })

  it('advances to the next opener and reloads its challenge', async () => {
    vi.spyOn(api, 'getOpeners').mockResolvedValue(openers)
    const getChallenge = vi
      .spyOn(api, 'getOpenerChallenge')
      .mockImplementation(async (id: string): Promise<OpenerChallengeDto> =>
        id === 'op1'
          ? challenge
          : { openerId: 'op2', openerText: 'Off the top, no pause,', targetWord: 'flow', targetKey: 'oʊ', targetDeliveredKey: null, validWords: [] },
      )

    render(<OpenerMode />)
    await screen.findByText('fire')

    fireEvent.click(screen.getByRole('button', { name: /next opener/i }))
    expect(await screen.findByText('flow')).toBeTruthy()
    expect(getChallenge).toHaveBeenCalledWith('op2')
  })
})
