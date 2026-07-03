import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import RhymeToken from './RhymeToken'
import DetectorLegend, { DETECTORS } from './DetectorLegend'

afterEach(() => {
  cleanup()
})

describe('RhymeToken', () => {
  it('applies an hsl background when a hue is provided', () => {
    const { container } = render(
      <RhymeToken text="explore" hue={120} detector="perfect-end" />,
    )
    const span = container.querySelector('span') as HTMLSpanElement
    expect(span).not.toBeNull()
    expect(span.textContent).toBe('explore')
    // jsdom's CSSOM normalizes hsl(...) to rgba(...); assert the tint (0.35 alpha) applied.
    expect(span.style.background).not.toBe('')
    expect(span.style.background).toContain('0.35')
    expect(span.title).toBe('perfect-end')
  })

  it('renders a plain span with no background when hue is null', () => {
    const { container } = render(<RhymeToken text="the" hue={null} />)
    const span = container.querySelector('span') as HTMLSpanElement
    expect(span.textContent).toBe('the')
    expect(span.style.background).toBe('')
  })
})

describe('DetectorLegend', () => {
  it('lists all six fixed detectors', () => {
    expect(DETECTORS).toHaveLength(6)
    const { container } = render(<DetectorLegend />)
    const text = container.textContent ?? ''
    for (const d of DETECTORS) {
      expect(text).toContain(d.label)
    }
  })

  it('renders a swatch per detector', () => {
    const { container } = render(<DetectorLegend />)
    const swatches = container.querySelectorAll('[data-swatch]')
    expect(swatches).toHaveLength(6)
  })
})
