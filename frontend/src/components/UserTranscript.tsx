import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { VideoAnalysisDto, UserAnnotationDto } from '../services/api'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"
const PALETTE = [8, 205, 130, 45, 280, 165, 95, 320, 235, 58, 300, 185]
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * Read-only render of the USER's saved annotation — the "fully new version":
 * only the bars/words you kept (deleted chatter is gone), colored by YOUR rhyme
 * families (keyed by sound), your verse breaks and per-word types. Same colors as
 * the editor. This is what /songs shows once you've annotated a song.
 */
export default function UserTranscript({ analysis, annotation }: {
  analysis: VideoAnalysisDto; annotation: UserAnnotationDto
}) {
  const { video, words } = analysis
  const meta = useMemo(() => {
    const m = new Map<number, { text: string; start: number }>()
    for (const w of words) m.set(w.wordIndex, { text: w.text, start: w.start })
    return m
  }, [words])
  const bars = annotation.bars
  const groups = annotation.groups || {}
  const types = useMemo(() => {
    const m = new Map<number, string>()
    for (const [k, v] of Object.entries(annotation.types || {})) m.set(Number(k), v)
    return m
  }, [annotation.types])
  const paras = new Set(annotation.paras || [])
  const families = useMemo(() => {
    const firstIdx = (wis: number[]) => (wis.length ? Math.min(...wis) : Infinity)
    const order = Object.keys(groups).sort((a, b) => firstIdx(groups[a]!) - firstIdx(groups[b]!))
    const info = new Map<string, { hue: number; letter: string; label: string }>()
    order.forEach((k, i) => {
      const label = /^u\d+$/.test(k) ? '(slant)' : `/${k}/`
      info.set(k, { hue: PALETTE[i % PALETTE.length]!, letter: LETTERS[i % LETTERS.length]!, label })
    })
    return { order, info }
  }, [groups])
  const gidOfWord = useMemo(() => {
    const m = new Map<number, string>()
    for (const [k, wis] of Object.entries(groups)) for (const wi of wis) m.set(wi, k)
    return m
  }, [groups])
  const barLast = useMemo(() => { const s = new Set<number>(); for (const b of bars) if (b.length) s.add(b[b.length - 1]!); return s }, [bars])
  const effType = (wi: number) => types.get(wi) ?? (barLast.has(wi) ? 'end' : null)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

  function wordStyle(wi: number): CSSProperties {
    const gid = gidOfWord.get(wi); const t = effType(wi)
    const hue = gid != null ? families.info.get(gid)?.hue ?? null : null
    const opener = t === 'opener'
    return {
      padding: '0 3px', borderRadius: 3,
      background: hue != null ? `hsl(${hue} 75% 50% / 0.42)` : (opener ? 'rgba(120,180,255,0.14)' : undefined),
      fontWeight: t === 'end' ? 700 : 400, fontStyle: t === 'slant' ? 'italic' : undefined,
      textDecoration: t === 'internal' || t === 'multi' ? 'underline' : undefined,
      textDecorationStyle: t === 'multi' ? 'double' : t === 'internal' ? 'dotted' : undefined, textUnderlineOffset: '2px',
      boxShadow: opener ? 'inset 0 -2px 0 0 var(--color-primary)' : undefined,
    }
  }

  return (
    <div>
      {families.order.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap', fontSize: '0.72rem' }}>
          <span style={{ color: 'var(--color-muted)', fontFamily: MONO }}>Your rhyme families:</span>
          {families.order.map((k) => {
            const f = families.info.get(k)!
            return (
              <span key={k} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 5,
                fontFamily: MONO, fontSize: '0.7rem', color: '#0a0a0a', fontWeight: 700,
                background: `hsl(${f.hue} 75% 50% / 0.9)`,
              }}>{f.letter} {f.label} ·{groups[k]!.length}</span>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        {bars.map((bar, bi) => (
          <div key={bi}>
            {paras.has(bi) && bi > 0 && <div style={{ height: 1, background: 'var(--color-border)', margin: '0.7rem 0 0.5rem', marginLeft: '3.2rem' }} />}
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', padding: '0.08rem 0' }}>
              <span style={{ width: '2.6rem', flexShrink: 0, textAlign: 'right', fontFamily: MONO, fontSize: '0.7rem', color: 'var(--color-muted)' }}>
                {video.youtubeId && bar.length ? (
                  <a href={`https://www.youtube.com/watch?v=${video.youtubeId}&t=${Math.floor(meta.get(bar[0]!)?.start ?? 0)}s`}
                     target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                    {fmt(meta.get(bar[0]!)?.start ?? 0)}
                  </a>
                ) : (bar.length ? fmt(meta.get(bar[0]!)?.start ?? 0) : '')}
              </span>
              <p style={{ margin: 0, lineHeight: 1.9 }}>
                {bar.map((wi, wIdx) => {
                  const gid = gidOfWord.get(wi); const letter = gid != null ? families.info.get(gid)?.letter : null
                  return (
                    <span key={wi}>
                      {wIdx > 0 && ' '}
                      <span style={wordStyle(wi)}>{meta.get(wi)?.text ?? '?'}{letter && <sub style={{ fontFamily: MONO, fontSize: '0.6em', opacity: 0.8 }}>{letter}</sub>}</span>
                    </span>
                  )
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
