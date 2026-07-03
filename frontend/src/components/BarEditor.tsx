import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoAnalysisDto } from '../services/api'
import { api } from '../services/api'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

interface Props {
  analysis: VideoAnalysisDto
  videoId: string
}

/**
 * Human-in-the-loop bar editor. The transcript is rendered as editable bars:
 * click a word to place the caret, press ENTER to split the bar after it, and
 * BACKSPACE at the start of a bar to join it with the previous one. The user's
 * bar boundaries are the source of truth and are persisted per video (they also
 * become training labels). Machine rhyme colors are shown for context.
 */
export default function BarEditor({ analysis, videoId }: Props) {
  const words = useMemo(
    () => [...analysis.words].sort((a, b) => a.wordIndex - b.wordIndex),
    [analysis.words],
  )
  const meta = useMemo(() => {
    const m = new Map<number, { text: string; start: number }>()
    for (const w of words) m.set(w.wordIndex, { text: w.text, start: w.start })
    return m
  }, [words])
  const hueByWord = useMemo(() => {
    const hueByGroup = new Map<number, number>()
    for (const g of analysis.groups) hueByGroup.set(g.groupIndex, g.hue)
    const m = new Map<number, number | null>()
    for (const e of analysis.events)
      m.set(e.wordIndex, e.groupIndex != null ? hueByGroup.get(e.groupIndex) ?? null : null)
    return m
  }, [analysis])

  const [bars, setBars] = useState<number[][]>([])
  const [caret, setCaret] = useState<{ b: number; w: number }>({ b: 0, w: 0 })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const autoSegment = useMemo(() => (): number[][] => {
    const out: number[][] = []
    let cur: number[] = []
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!
      cur.push(w.wordIndex)
      const next = words[i + 1]
      const gap = next ? next.start - w.end : Infinity
      if ((cur.length >= 2 && (/[.?!]$/.test(w.text) || gap > 0.5)) || !next) {
        out.push(cur)
        cur = []
      }
    }
    if (cur.length) out.push(cur)
    return out
  }, [words])

  useEffect(() => {
    let cancelled = false
    api.getAnnotation(videoId)
      .then((a) => {
        if (cancelled) return
        setBars(a && a.bars.length ? a.bars : autoSegment())
        setStatus(a && a.bars.length ? 'loaded your saved bars' : 'auto-split — edit and save')
      })
      .catch(() => { if (!cancelled) { setBars(autoSegment()); setStatus('auto-split — edit and save') } })
    return () => { cancelled = true }
  }, [videoId, autoSegment])

  function splitAtCaret() {
    setBars((prev) => {
      const bar = prev[caret.b]
      if (!bar || caret.w >= bar.length - 1) return prev // nothing after caret
      const b = prev.map((x) => [...x])
      const after = b[caret.b]!.slice(caret.w + 1)
      b[caret.b] = b[caret.b]!.slice(0, caret.w + 1)
      b.splice(caret.b + 1, 0, after)
      return b
    })
    setCaret((c) => ({ b: c.b + 1, w: 0 }))
    setDirty(true)
  }

  function joinWithPrev() {
    if (caret.b === 0 || caret.w !== 0) return
    setBars((prev) => {
      const b = prev.map((x) => [...x])
      const prevLen = b[caret.b - 1]!.length
      b[caret.b - 1] = [...b[caret.b - 1]!, ...b[caret.b]!]
      b.splice(caret.b, 1)
      setCaret({ b: caret.b - 1, w: prevLen })
      return b
    })
    setDirty(true)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); splitAtCaret() }
    else if (e.key === 'Backspace' && caret.w === 0) { e.preventDefault(); joinWithPrev() }
  }

  async function save() {
    setSaving(true)
    try {
      await api.putAnnotation(videoId, { bars, groups: {} })
      setDirty(false)
      setStatus('saved ✓')
    } catch {
      setStatus('save failed')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setBars(autoSegment())
    setCaret({ b: 0, w: 0 })
    setDirty(true)
    setStatus('re-split — save to keep')
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60)
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <strong style={{ fontFamily: MONO, fontSize: '0.8rem' }}>Edit bars</strong>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>
          click a word, press <kbd>Enter</kbd> to split the bar there · <kbd>Backspace</kbd> at a bar start joins up
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>{status}</span>
        <button onClick={reset} style={btnStyle(false)}>Re-split</button>
        <button onClick={save} disabled={saving || !dirty} style={btnStyle(dirty && !saving)}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{
          display: 'flex', flexDirection: 'column', gap: '0.15rem', outline: 'none',
          border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.5rem 0.6rem',
        }}
      >
        {bars.map((bar, bi) => (
          <div key={bi} style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', padding: '0.1rem 0' }}>
            <span style={{ width: '2.6rem', flexShrink: 0, textAlign: 'right', fontFamily: MONO, fontSize: '0.7rem', color: 'var(--color-muted)' }}>
              {bar.length ? fmt(meta.get(bar[0]!)?.start ?? 0) : ''}
            </span>
            <p style={{ margin: 0, lineHeight: 1.8 }}>
              {bar.map((wi, wIdx) => {
                const hue = hueByWord.get(wi) ?? null
                const isCaret = caret.b === bi && caret.w === wIdx
                return (
                  <span key={wi}>
                    {wIdx > 0 && ' '}
                    <span
                      onClick={() => { setCaret({ b: bi, w: wIdx }); containerRef.current?.focus() }}
                      style={{
                        cursor: 'text',
                        padding: '0 3px',
                        borderRadius: 3,
                        background: hue != null ? `hsl(${hue} 75% 50% / 0.32)` : undefined,
                        boxShadow: isCaret ? 'inset 0 -2px 0 0 var(--color-primary)' : undefined,
                        outline: isCaret ? '1px solid var(--color-primary)' : undefined,
                      }}
                    >
                      {meta.get(wi)?.text ?? '?'}
                    </span>
                  </span>
                )
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: MONO, fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5,
    border: '1px solid var(--color-border)', cursor: active ? 'pointer' : 'default',
    background: active ? 'var(--color-primary)' : 'transparent',
    color: active ? '#0a0a0a' : 'var(--color-muted)',
  }
}
