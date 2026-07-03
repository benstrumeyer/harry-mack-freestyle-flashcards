import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoAnalysisDto } from '../services/api'
import { api } from '../services/api'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"
const USER_PALETTE = [8, 205, 130, 45, 280, 165, 95, 320, 235, 58, 300, 185]
const TYPE_KEYS: Record<string, string> = { b: 'end', u: 'internal', i: 'slant', m: 'multi' }

interface Props { analysis: VideoAnalysisDto; videoId: string }
type Pos = { b: number; w: number }

/**
 * Rap-annotation editor. A single arrow-navigable cursor works in both modes:
 *   ← → move word (wrap across bars) · ↑ ↓ move line.
 * BARS:  Enter split · Shift+Enter verse · Backspace(at bar start) join.
 * RHYMES: Space (or click) the cursor word to link it to the anchor = rhyme it;
 *   Ctrl/Cmd+B/U/I/M set type (end/internal/slant/multi) on the cursor word.
 * Bar-final word auto = end-rhyme. Bars+verses+groups+types persist per video.
 */
export default function BarEditor({ analysis, videoId }: Props) {
  const words = useMemo(() => [...analysis.words].sort((a, b) => a.wordIndex - b.wordIndex), [analysis.words])
  const meta = useMemo(() => {
    const m = new Map<number, { text: string; start: number }>()
    for (const w of words) m.set(w.wordIndex, { text: w.text, start: w.start })
    return m
  }, [words])

  const [mode, setMode] = useState<'bars' | 'rhymes'>('bars')
  const [bars, setBars] = useState<number[][]>([])
  const [paras, setParas] = useState<number[]>([])
  const [groups, setGroups] = useState<Record<string, number[]>>({})
  const [types, setTypes] = useState<Record<number, string>>({})
  const [cur, setCur] = useState<Pos>({ b: 0, w: 0 })
  const [anchor, setAnchor] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const autoSegment = useMemo(() => (): number[][] => {
    const out: number[][] = []; let cur: number[] = []
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!; cur.push(w.wordIndex)
      const next = words[i + 1]; const gap = next ? next.start - w.end : Infinity
      if ((cur.length >= 2 && (/[.?!]$/.test(w.text) || gap > 0.5)) || !next) { out.push(cur); cur = [] }
    }
    if (cur.length) out.push(cur)
    return out
  }, [words])

  useEffect(() => {
    let cancelled = false
    api.getAnnotation(videoId).then((a) => {
      if (cancelled) return
      setBars(a && a.bars.length ? a.bars : autoSegment())
      setGroups(a?.groups ?? {})
      setParas(a?.paras ?? [])
      setTypes(Object.fromEntries(Object.entries(a?.types ?? {}).map(([k, v]) => [Number(k), v])))
      setStatus(a && a.bars.length ? 'loaded your saved annotation' : 'auto-split — edit and save')
    }).catch(() => { if (!cancelled) { setBars(autoSegment()); setStatus('auto-split — edit and save') } })
    return () => { cancelled = true }
  }, [videoId, autoSegment])

  // Groups are numbered slots g1..g10 → fixed palette color by number (stable).
  const numOfGid = (gid: string) => Math.max(1, parseInt(gid.replace(/\D/g, '') || '1', 10))
  const hueOfNum = (n: number) => USER_PALETTE[(n - 1) % USER_PALETTE.length]!
  const hueOfGid = (gid: string) => hueOfNum(numOfGid(gid))
  const gidOfWord = useMemo(() => {
    const m = new Map<number, string>()
    for (const [gid, wis] of Object.entries(groups)) for (const wi of wis) m.set(wi, gid)
    return m
  }, [groups])
  const barLastWord = useMemo(() => {
    const s = new Set<number>(); for (const bar of bars) if (bar.length) s.add(bar[bar.length - 1]!); return s
  }, [bars])
  const effType = (wi: number) => types[wi] ?? (barLastWord.has(wi) ? 'end' : null)
  const wiAt = (p: Pos): number | null => bars[p.b]?.[p.w] ?? null
  const curWi = wiAt(cur)

  // ---- cursor navigation ----
  const clampW = (b: number, w: number) => Math.max(0, Math.min(w, (bars[b]?.length ?? 1) - 1))
  function move(dir: 'left' | 'right' | 'up' | 'down') {
    setCur((c) => {
      if (dir === 'left') {
        if (c.w > 0) return { b: c.b, w: c.w - 1 }
        if (c.b > 0) return { b: c.b - 1, w: (bars[c.b - 1]?.length ?? 1) - 1 }
        return c
      }
      if (dir === 'right') {
        if (c.w < (bars[c.b]?.length ?? 1) - 1) return { b: c.b, w: c.w + 1 }
        if (c.b < bars.length - 1) return { b: c.b + 1, w: 0 }
        return c
      }
      if (dir === 'up' && c.b > 0) return { b: c.b - 1, w: clampW(c.b - 1, c.w) }
      if (dir === 'down' && c.b < bars.length - 1) return { b: c.b + 1, w: clampW(c.b + 1, c.w) }
      return c
    })
  }

  // ---- bars editing ----
  function splitAtCur() {
    setBars((prev) => {
      const bar = prev[cur.b]; if (!bar || cur.w >= bar.length - 1) return prev
      const b = prev.map((x) => [...x]); const after = b[cur.b]!.slice(cur.w + 1)
      b[cur.b] = b[cur.b]!.slice(0, cur.w + 1); b.splice(cur.b + 1, 0, after)
      setParas((p) => p.map((x) => (x > cur.b ? x + 1 : x)))
      return b
    })
    setCur((c) => ({ b: c.b + 1, w: 0 })); setDirty(true)
  }
  function joinWithPrev() {
    if (cur.b === 0 || cur.w !== 0) return
    setBars((prev) => {
      const b = prev.map((x) => [...x]); const prevLen = b[cur.b - 1]!.length
      b[cur.b - 1] = [...b[cur.b - 1]!, ...b[cur.b]!]; b.splice(cur.b, 1)
      setParas((p) => p.filter((x) => x !== cur.b).map((x) => (x > cur.b ? x - 1 : x)))
      setCur({ b: cur.b - 1, w: prevLen }); return b
    })
    setDirty(true)
  }
  function toggleVerse() {
    if (cur.b === 0) return
    setParas((p) => (p.includes(cur.b) ? p.filter((x) => x !== cur.b) : [...p, cur.b].sort((a, b) => a - b)))
    setDirty(true)
  }

  // ---- rhyme linking + types ----
  function firstFreeGid(g: Record<string, number[]>) { let n = 0; while (g[`g${n}`]) n++; return `g${n}` }
  function link(a: number, wi: number) {
    setGroups((g) => {
      const next: Record<string, number[]> = {}
      for (const [gid, wis] of Object.entries(g)) next[gid] = [...wis]
      let gid = [...Object.entries(next)].find(([, wis]) => wis.includes(a))?.[0]
      if (!gid) { gid = firstFreeGid(next); next[gid] = [a] }
      if (next[gid]!.includes(wi)) next[gid] = next[gid]!.filter((x) => x !== wi)
      else { for (const id of Object.keys(next)) if (id !== gid) next[id] = next[id]!.filter((x) => x !== wi); next[gid] = [...next[gid]!, wi] }
      for (const id of Object.keys(next)) if (!next[id]!.length) delete next[id]
      return next
    })
    setDirty(true)
  }
  function pick(wi: number) {                     // Space / click in rhymes mode
    if (anchor === null) { setAnchor(wi); return }
    if (anchor === wi) { setAnchor(null); return }
    link(anchor, wi); setAnchor(wi)
  }
  function setType(wi: number, t: string) {
    setTypes((m) => { const n = { ...m }; if (n[wi] === t) delete n[wi]; else n[wi] = t; return n }); setDirty(true)
  }
  // Number keys 1-10: put the cursor word in rhyme group N (toggle).
  function assignGroup(wi: number, n: number) {
    const gid = `g${n}`
    setGroups((g) => {
      const next: Record<string, number[]> = {}
      for (const [id, wis] of Object.entries(g)) next[id] = [...wis]
      const had = next[gid]?.includes(wi)
      for (const id of Object.keys(next)) next[id] = next[id]!.filter((x) => x !== wi)
      if (!had) next[gid] = [...(next[gid] ?? []), wi]
      for (const id of Object.keys(next)) if (!next[id]!.length) delete next[id]
      return next
    })
    setDirty(true)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const k = e.key
    if (k === 'ArrowLeft') { e.preventDefault(); move('left'); return }
    if (k === 'ArrowRight') { e.preventDefault(); move('right'); return }
    if (k === 'ArrowUp') { e.preventDefault(); move('up'); return }
    if (k === 'ArrowDown') { e.preventDefault(); move('down'); return }
    // Number keys 1-9,0 → rhyme group 1-10 on the cursor word (works in both modes).
    if (/^[0-9]$/.test(k) && curWi != null && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); assignGroup(curWi, k === '0' ? 10 : parseInt(k, 10)); return
    }
    if (mode === 'bars') {
      if (k === 'Enter' && e.shiftKey) { e.preventDefault(); toggleVerse() }
      else if (k === 'Enter') { e.preventDefault(); splitAtCur() }
      else if (k === 'Backspace' && cur.w === 0) { e.preventDefault(); joinWithPrev() }
    } else {
      if (k === ' ' || k === 'Enter') { e.preventDefault(); if (curWi != null) pick(curWi) }
      else if ((e.ctrlKey || e.metaKey) && TYPE_KEYS[k.toLowerCase()]) {
        e.preventDefault(); if (curWi != null) setType(curWi, TYPE_KEYS[k.toLowerCase()]!)
      }
    }
  }

  function onWordClick(b: number, w: number, wi: number) {
    setCur({ b, w }); containerRef.current?.focus()
    if (mode === 'rhymes') pick(wi)
  }

  async function save() {
    setSaving(true)
    try {
      await api.putAnnotation(videoId, { bars, groups, paras, types: Object.fromEntries(Object.entries(types).map(([k, v]) => [String(k), v])) })
      setDirty(false); setStatus('saved ✓')
    } catch { setStatus('save failed') } finally { setSaving(false) }
  }
  function reset() { setBars(autoSegment()); setParas([]); setCur({ b: 0, w: 0 }); setDirty(true); setStatus('re-split — save to keep') }
  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

  function wordStyle(wi: number, isCur: boolean): React.CSSProperties {
    const gid = gidOfWord.get(wi); const t = effType(wi); const hue = gid != null ? hueOfGid(gid) : null
    return {
      cursor: 'pointer', padding: '0 3px', borderRadius: 3,
      background: hue != null ? `hsl(${hue} 75% 50% / 0.45)` : (isCur ? 'var(--color-hover, rgba(255,255,255,0.08))' : undefined),
      fontWeight: t === 'end' ? 700 : 400,
      fontStyle: t === 'slant' ? 'italic' : undefined,
      textDecoration: t === 'internal' || t === 'multi' ? 'underline' : undefined,
      textDecorationStyle: t === 'multi' ? 'double' : t === 'internal' ? 'dotted' : undefined,
      textUnderlineOffset: '2px',
      outline: isCur ? '2px solid var(--color-primary)' : (anchor === wi ? '1px dashed var(--color-primary)' : undefined),
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['bars', 'rhymes'] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); containerRef.current?.focus() }} style={{
              fontFamily: MONO, fontSize: '0.72rem', padding: '4px 12px', cursor: 'pointer', border: 'none',
              background: mode === m ? 'var(--color-primary)' : 'transparent', color: mode === m ? '#0a0a0a' : 'var(--color-muted)',
            }}>{m === 'bars' ? '¶ Bars' : '♪ Rhymes'}</button>
          ))}
        </div>
        <span style={{ fontSize: '0.74rem', color: 'var(--color-muted)' }}>
          <kbd>←→↑↓</kbd> move · <kbd>1</kbd>–<kbd>0</kbd> rhyme group · {mode === 'bars'
            ? <><kbd>Enter</kbd> split · <kbd>Shift+Enter</kbd> verse · <kbd>Backspace</kbd> join</>
            : <><kbd>Space</kbd> link · <kbd>Ctrl</kbd>+B/U/I/M type</>}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>{status}</span>
        {mode === 'bars' && <button onClick={reset} style={btn(false)}>Re-split</button>}
        <button onClick={save} disabled={saving || !dirty} style={btn(dirty && !saving)}>{saving ? 'Saving…' : 'Save'}</button>
      </div>

      {/* Color/style legend: numbered rhyme groups + Word-style type marks. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap', fontSize: '0.72rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: 'var(--color-muted)', fontFamily: MONO }}>Groups:</span>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const gid = `g${n}`
            const used = (groups[gid]?.length ?? 0) > 0
            const curG = curWi != null ? gidOfWord.get(curWi) : undefined
            const key = n === 10 ? '0' : String(n)
            return (
              <span key={n} title={`rhyme group ${n} — press ${key}`} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 20, height: 18, borderRadius: 4, fontFamily: MONO, fontSize: '0.68rem',
                fontWeight: 700, color: '#0a0a0a', background: `hsl(${hueOfNum(n)} 75% 50% / ${used ? 0.9 : 0.25})`,
                outline: curG === gid ? '2px solid var(--color-primary)' : 'none',
              }}>{key}</span>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--color-muted)' }}>
          <span style={{ fontFamily: MONO }}>Types:</span>
          <span title="Ctrl+B" style={{ fontWeight: 700, color: 'var(--color-text)' }}>bold = end</span>
          <span title="Ctrl+I" style={{ fontStyle: 'italic', color: 'var(--color-text)' }}>italic = slant</span>
          <span title="Ctrl+U" style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', color: 'var(--color-text)' }}>internal</span>
          <span title="Ctrl+M" style={{ textDecoration: 'underline', textDecorationStyle: 'double', color: 'var(--color-text)' }}>multi</span>
        </div>
      </div>

      <div ref={containerRef} tabIndex={0} onKeyDown={onKeyDown} style={{
        display: 'flex', flexDirection: 'column', outline: 'none',
        border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.5rem 0.6rem',
      }}>
        {bars.map((bar, bi) => (
          <div key={bi}>
            {paras.includes(bi) && bi > 0 && (
              <div style={{ height: 1, background: 'var(--color-border)', margin: '0.7rem 0 0.5rem', marginLeft: '3.2rem' }} />
            )}
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', padding: '0.08rem 0' }}>
              <span style={{ width: '2.6rem', flexShrink: 0, textAlign: 'right', fontFamily: MONO, fontSize: '0.7rem', color: 'var(--color-muted)' }}>
                {bar.length ? fmt(meta.get(bar[0]!)?.start ?? 0) : ''}
              </span>
              <p style={{ margin: 0, lineHeight: 1.9 }}>
                {bar.map((wi, wIdx) => (
                  <span key={wi}>
                    {wIdx > 0 && ' '}
                    <span onClick={() => onWordClick(bi, wIdx, wi)} style={wordStyle(wi, cur.b === bi && cur.w === wIdx)}>
                      {meta.get(wi)?.text ?? '?'}
                    </span>
                  </span>
                ))}
              </p>
            </div>
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
    background: active ? 'var(--color-primary)' : 'transparent', color: active ? '#0a0a0a' : 'var(--color-muted)',
  }
}
