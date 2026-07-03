import { useMemo } from 'react'
import type { VideoAnalysisDto, RhymeEventDto } from '../services/api'
import RhymeToken from './RhymeToken'

interface Props {
  analysis: VideoAnalysisDto
}

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

function fmtTimestamp(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Break the line ON a rhyme once it reaches a natural stop: a pause after the
// word, or sentence/phrase punctuation. So each bar ENDS on its rhyme.
const PAUSE_S = 0.28
const HARD_PAUSE_S = 0.7
const MIN_BAR_WORDS = 3
const MAX_BAR_WORDS = 14
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

interface BarWord {
  wordIndex: number
  text: string
  start: number
  end: number
  groupIndex: number | null
  hue: number | null
  groupKey: string | null
  detector: string | null
  isEnd: boolean
  isInternal: boolean
}
interface Bar {
  start: number
  endGroup: number | null
  letter: string | null
  words: BarWord[]
}

/**
 * Renders the transcript as ACTUAL BARS: each line is a bar that ends on its
 * rhyme, with a scheme letter (A/B/C…) in the left gutter so the rhyme scheme
 * reads vertically (AABB/ABAB). The ending rhyme is bold; internal rhymes are
 * underlined; words that rhyme share a color. Each bar deep-links to its moment.
 */
export default function AnnotatedTranscript({ analysis }: Props) {
  const { video, words, events, groups } = analysis

  const bars = useMemo<Bar[]>(() => {
    const evByWord = new Map<number, RhymeEventDto>()
    for (const e of events) evByWord.set(e.wordIndex, e)
    const hueByGroup = new Map<number, number>()
    const keyByGroup = new Map<number, string>()
    for (const g of groups) { hueByGroup.set(g.groupIndex, g.hue); keyByGroup.set(g.groupIndex, g.key ?? '') }

    const ordered = [...words].sort((a, b) => a.wordIndex - b.wordIndex)

    // 1) segment into bars that end on a rhyme (or a hard pause for chatter).
    const rawBars: BarWord[][] = []
    let cur: BarWord[] = []
    for (let i = 0; i < ordered.length; i++) {
      const w = ordered[i]!
      const ev = evByWord.get(w.wordIndex)
      const gi = ev && ev.groupIndex != null ? ev.groupIndex : null
      cur.push({
        wordIndex: w.wordIndex, text: w.text, start: w.start, end: w.end,
        groupIndex: gi,
        hue: gi != null ? hueByGroup.get(gi) ?? null : null,
        groupKey: gi != null ? keyByGroup.get(gi) ?? null : null,
        detector: ev?.detector ?? null,
        isEnd: false, isInternal: false,
      })
      const next = ordered[i + 1]
      const gapAfter = next ? next.start - w.end : Infinity
      const endsPhrase = /[.?!,]$/.test(w.text)
      const closeOnRhyme = cur.length >= MIN_BAR_WORDS && gi != null && (gapAfter > PAUSE_S || endsPhrase)
      if (closeOnRhyme || gapAfter > HARD_PAUSE_S || cur.length >= MAX_BAR_WORDS || !next) {
        rawBars.push(cur)
        cur = []
      }
    }

    // 2) per bar: pick the ENDING rhyme = last word that carries a group; mark
    //    it as the anchor (isEnd) and any earlier rhyme words as internal.
    const isWord = (t: string) => t.replace(/[^a-z']/gi, '').length > 0
    const out: Bar[] = []
    for (const bw of rawBars) {
      let endIdx = -1
      for (let i = bw.length - 1; i >= 0; i--) {
        if (bw[i]!.groupIndex != null) { endIdx = i; break }
      }
      // The bar "ends on a rhyme" only if nothing but punctuation follows the
      // last rhyme word. Otherwise that rhyme is internal and the bar gets no
      // scheme letter (it's a phrase that doesn't land on a rhyme).
      let terminal = endIdx >= 0
      for (let i = endIdx + 1; i < bw.length; i++) {
        if (isWord(bw[i]!.text)) { terminal = false; break }
      }
      for (let i = 0; i < bw.length; i++) {
        if (bw[i]!.groupIndex == null) continue
        if (i === endIdx && terminal) bw[i]!.isEnd = true
        else bw[i]!.isInternal = true
      }
      out.push({
        start: bw[0]!.start,
        endGroup: terminal ? bw[endIdx]!.groupIndex : null,
        letter: null,
        words: bw,
      })
    }

    // 3) assign scheme letters by end-group first appearance (read down = scheme).
    const letterByGroup = new Map<number, string>()
    for (const b of out) {
      if (b.endGroup == null) continue
      if (!letterByGroup.has(b.endGroup)) {
        letterByGroup.set(b.endGroup, LETTERS[letterByGroup.size % LETTERS.length]!)
      }
      b.letter = letterByGroup.get(b.endGroup)!
    }
    return out
  }, [words, events, groups])

  const endHueByGroup = useMemo(() => {
    const m = new Map<number, number>()
    for (const g of groups) m.set(g.groupIndex, g.hue)
    return m
  }, [groups])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '1rem' }}>
      {bars.map((bar, bi) => {
        const hue = bar.endGroup != null ? endHueByGroup.get(bar.endGroup) ?? null : null
        const yt = video.youtubeId
          ? `https://www.youtube.com/watch?v=${video.youtubeId}&t=${Math.floor(bar.start)}s`
          : undefined
        return (
          <div key={bi} style={{ display: 'flex', gap: '0.7rem', alignItems: 'baseline', padding: '0.12rem 0' }}>
            {/* Scheme letter — read down the column to see the rhyme scheme. */}
            <span style={{ width: '1.5rem', flexShrink: 0, textAlign: 'center' }}>
              {bar.letter && (
                <span style={{
                  display: 'inline-block', minWidth: '1.25rem', padding: '1px 4px', borderRadius: 4,
                  fontFamily: MONO, fontSize: '0.8rem', fontWeight: 800, lineHeight: 1.3,
                  background: hue != null ? `hsl(${hue} 75% 50% / 0.9)` : 'transparent',
                  color: '#0a0a0a',
                }}>{bar.letter}</span>
              )}
            </span>
            {/* Timestamp deep-link. */}
            {yt ? (
              <a href={yt} target="_blank" rel="noopener noreferrer"
                 style={{ width: '2.6rem', flexShrink: 0, textAlign: 'right', fontFamily: MONO, fontSize: '0.72rem', color: 'var(--color-primary)', textDecoration: 'none' }}>
                {fmtTimestamp(bar.start)}
              </a>
            ) : (
              <span style={{ width: '2.6rem', flexShrink: 0, textAlign: 'right', fontFamily: MONO, fontSize: '0.72rem', color: 'var(--color-muted)' }}>
                {fmtTimestamp(bar.start)}
              </span>
            )}
            {/* The bar. */}
            <p style={{ margin: 0, lineHeight: 1.75, color: 'var(--color-text)' }}>
              {bar.words.map((w, wi) => (
                <span key={w.wordIndex}>
                  {wi > 0 && ' '}
                  {w.hue != null ? (
                    <RhymeToken text={w.text} hue={w.hue} groupKey={w.groupKey} detector={w.detector}
                                isEnd={w.isEnd} isInternal={w.isInternal} />
                  ) : w.text}
                </span>
              ))}
            </p>
          </div>
        )
      })}
    </div>
  )
}
