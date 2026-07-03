import { useMemo } from 'react'
import type { VideoAnalysisDto, RhymeEventDto } from '../services/api'
import RhymeToken from './RhymeToken'
import SchemeBadge from './SchemeBadge'

interface Props {
  analysis: VideoAnalysisDto
}

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

function fmtTimestamp(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

interface BarBlock {
  barIndex: number | null
  start: number
  words: { wordIndex: number; text: string; hue: number | null; groupKey: string | null; detector: string | null }[]
}

/**
 * Renders the full transcript grouped into bars. Each rhyme-event word is wrapped in a
 * RhymeToken tinted with its group hue; each bar is prefixed by a YouTube timestamp
 * deep-link and a SchemeBadge showing the bar's rhyme scheme.
 */
export default function AnnotatedTranscript({ analysis }: Props) {
  const { video, words, events, groups, scheme } = analysis

  const blocks = useMemo<BarBlock[]>(() => {
    const eventByWord = new Map<number, RhymeEventDto>()
    for (const e of events) eventByWord.set(e.wordIndex, e)
    const hueByGroup = new Map<number, number>()
    const keyByGroup = new Map<number, string>()
    for (const g of groups) { hueByGroup.set(g.groupIndex, g.hue); keyByGroup.set(g.groupIndex, g.key ?? '') }

    const ordered = [...words].sort((a, b) => a.wordIndex - b.wordIndex)
    const out: BarBlock[] = []
    let currentBar: number | null = null
    let block: BarBlock | null = null

    for (const w of ordered) {
      const ev = eventByWord.get(w.wordIndex)
      if (ev && ev.barIndex >= 0) currentBar = ev.barIndex
      if (!block || block.barIndex !== currentBar) {
        block = { barIndex: currentBar, start: w.start, words: [] }
        out.push(block)
      }
      const gi = ev && ev.groupIndex != null ? ev.groupIndex : null
      const hue = gi != null ? hueByGroup.get(gi) ?? null : null
      const groupKey = gi != null ? keyByGroup.get(gi) ?? null : null
      block.words.push({ wordIndex: w.wordIndex, text: w.text, hue, groupKey, detector: ev?.detector ?? null })
    }
    return out
  }, [words, events, groups])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {blocks.map((block, bi) => {
        const hasBar = block.barIndex != null
        const barScheme = hasBar ? scheme[block.barIndex as number] : null
        const href = `https://www.youtube.com/watch?v=${video.id}&t=${Math.floor(block.start)}s`
        return (
          <div key={bi} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem', flexShrink: 0, minWidth: '3.2rem' }}>
              {hasBar ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: MONO, fontSize: '0.72rem', color: 'var(--color-primary)', textDecoration: 'none' }}
                >
                  {fmtTimestamp(block.start)}
                </a>
              ) : (
                <span style={{ fontFamily: MONO, fontSize: '0.72rem', color: 'var(--color-muted)' }}>—</span>
              )}
              {barScheme && <SchemeBadge scheme={barScheme} />}
            </div>
            <p style={{ margin: 0, lineHeight: 1.7, fontSize: '0.95rem', color: 'var(--color-text)' }}>
              {block.words.map((w, wi) => (
                <span key={w.wordIndex}>
                  {wi > 0 && ' '}
                  <RhymeToken text={w.text} hue={w.hue} groupKey={w.groupKey} detector={w.detector} />
                </span>
              ))}
            </p>
          </div>
        )
      })}
    </div>
  )
}
