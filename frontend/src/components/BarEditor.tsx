import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoAnalysisDto } from '../services/api'
import { api } from '../services/api'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"
// Distinct, reused hues for the user's own rhyme groups.
const USER_PALETTE = [8, 205, 130, 45, 280, 165, 95, 320, 235, 58, 300, 185]

interface Props {
  analysis: VideoAnalysisDto
  videoId: string
}

/**
 * Human-in-the-loop annotation. Two modes:
 *  • BARS — click a word, ENTER splits the bar there, BACKSPACE at a bar start joins up.
 *  • RHYMES — pick/create a group, then click words to add/remove them (colored).
 * The user's bars + rhyme groups are the source of truth, persisted per video
 * (and become training labels). Machine colors show only as faint context.
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
  const machineHue = useMemo(() => {
    const hueByGroup = new Map<number, number>()
    for (const g of analysis.groups) hueByGroup.set(g.groupIndex, g.hue)
    const m = new Map<number, number | null>()
    for (const e of analysis.events)
      m.set(e.wordIndex, e.groupIndex != null ? hueByGroup.get(e.groupIndex) ?? null : null)
    return m
  }, [analysis])

  const [mode, setMode] = useState<'bars' | 'rhymes'>('bars')
  const [bars, setBars] = useState<number[][]>([])
  const [groups, setGroups] = useState<Record<string, number[]>>({})
  const [activeGid, setActiveGid] = useState<string | null>(null)
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
      if ((cur.length >= 2 && (/[.?!]$/.test(w.text) || gap > 0.5)) || !next) { out.push(cur); cur = [] }
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
        setGroups(a?.groups ?? {})
        setStatus(a && a.bars.length ? 'loaded your saved annotation' : 'auto-split — edit and save')
      })
      .catch(() => { if (!cancelled) { setBars(autoSegment()); setStatus('auto-split — edit and save') } })
    return () => { cancelled = true }
  }, [videoId, autoSegment])

  const gids = useMemo(() => Object.keys(groups), [groups])
  const hueOfGid = (gid: string) => USER_PALETTE[Math.max(0, gids.indexOf(gid)) % USER_PALETTE.length]!
  const gidOfWord = useMemo(() => {
    const m = new Map<number, string>()
    for (const [gid, wis] of Object.entries(groups)) for (const wi of wis) m.set(wi, gid)
    return m
  }, [groups])

  // ---- bars editing ----
  function splitAtCaret() {
    setBars((prev) => {
      const bar = prev[caret.b]
      if (!bar || caret.w >= bar.length - 1) return prev
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
    if (mode !== 'bars') return
    if (e.key === 'Enter') { e.preventDefault(); splitAtCaret() }
    else if (e.key === 'Backspace' && caret.w === 0) { e.preventDefault(); joinWithPrev() }
  }

  // ---- rhyme grouping ----
  function newGroup() {
    let n = 0
    while (groups[`g${n}`]) n++
    const gid = `g${n}`
    setGroups((g) => ({ ...g, [gid]: [] }))
    setActiveGid(gid)
    setDirty(true)
  }
  function toggleWordInActive(wi: number) {
    if (!activeGid) return
    setGroups((g) => {
      const next: Record<string, number[]> = {}
      let wasInActive = false
      for (const [gid, wis] of Object.entries(g)) {
        const filtered = wis.filter((x) => x !== wi)
        if (gid === activeGid && wis.includes(wi)) wasInActive = true
        next[gid] = filtered
      }
      if (!wasInActive) next[activeGid] = [...(next[activeGid] ?? []), wi]
      return next
    })
    setDirty(true)
  }
  function deleteGroup(gid: string) {
    setGroups((g) => { const n = { ...g }; delete n[gid]; return n })
    if (activeGid === gid) setActiveGid(null)
    setDirty(true)
  }

  function onWordClick(bi: number, wIdx: number, wi: number) {
    if (mode === 'bars') { setCaret({ b: bi, w: wIdx }); containerRef.current?.focus() }
    else { toggleWordInActive(wi) }
  }

  async function save() {
    setSaving(true)
    try {
      await api.putAnnotation(videoId, { bars, groups })
      setDirty(false); setStatus('saved ✓')
    } catch { setStatus('save failed') } finally { setSaving(false) }
  }
  function reset() {
    setBars(autoSegment()); setCaret({ b: 0, w: 0 }); setDirty(true); setStatus('re-split — save to keep')
  }
  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['bars', 'rhymes'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontFamily: MONO, fontSize: '0.72rem', padding: '4px 12px', cursor: 'pointer', border: 'none',
              background: mode === m ? 'var(--color-primary)' : 'transparent',
              color: mode === m ? '#0a0a0a' : 'var(--color-muted)',
            }}>{m === 'bars' ? '¶ Bars' : '♪ Rhymes'}</button>
          ))}
        </div>
        <span style={{ fontSize: '0.76rem', color: 'var(--color-muted)' }}>
          {mode === 'bars'
            ? <>click a word · <kbd>Enter</kbd> split bar · <kbd>Backspace</kbd> at bar start joins up</>
            : <>pick/＋ a group, then click words to add/remove them</>}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>{status}</span>
        {mode === 'bars' && <button onClick={reset} style={btn(false)}>Re-split</button>}
        <button onClick={save} disabled={saving || !dirty} style={btn(dirty && !saving)}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {mode === 'rhymes' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button onClick={newGroup} style={btn(true)}>＋ New group</button>
          {gids.map((gid) => (
            <span key={gid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => setActiveGid(gid)} title="select group" style={{
                width: 22, height: 18, borderRadius: 4, cursor: 'pointer',
                background: `hsl(${hueOfGid(gid)} 75% 50% / 0.75)`,
                border: activeGid === gid ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              }} />
              <button onClick={() => deleteGroup(gid)} title="delete group" style={{
                background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.8rem',
              }}>✕</button>
            </span>
          ))}
          {gids.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>no groups yet — ＋ New group</span>}
        </div>
      )}

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
            <p style={{ margin: 0, lineHeight: 1.85 }}>
              {bar.map((wi, wIdx) => {
                const userGid = gidOfWord.get(wi)
                const hue = userGid != null ? hueOfGid(userGid) : (mode === 'rhymes' ? null : machineHue.get(wi) ?? null)
                const isCaret = mode === 'bars' && caret.b === bi && caret.w === wIdx
                const strong = userGid != null
                return (
                  <span key={wi}>
                    {wIdx > 0 && ' '}
                    <span
                      onClick={() => onWordClick(bi, wIdx, wi)}
                      style={{
                        cursor: mode === 'bars' ? 'text' : 'pointer',
                        padding: '0 3px', borderRadius: 3,
                        background: hue != null ? `hsl(${hue} 75% 50% / ${strong ? 0.6 : 0.28})` : undefined,
                        fontWeight: strong ? 600 : 400,
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

function btn(active: boolean): React.CSSProperties {
  return {
    fontFamily: MONO, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 5,
    border: '1px solid var(--color-border)', cursor: active ? 'pointer' : 'default',
    background: active ? 'var(--color-primary)' : 'transparent',
    color: active ? '#0a0a0a' : 'var(--color-muted)',
  }
}
