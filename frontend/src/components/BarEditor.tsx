import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoAnalysisDto } from '../services/api'
import { api } from '../services/api'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"
const USER_PALETTE = [8, 205, 130, 45, 280, 165, 95, 320, 235, 58, 300, 185]
// Word-native hotkeys → rhyme annotation type.
const TYPE_KEYS: Record<string, string> = { b: 'end', u: 'internal', i: 'slant', m: 'multi' }

interface Props { analysis: VideoAnalysisDto; videoId: string }

/**
 * Rap-annotation editor (Word/markdown style).
 *  BARS: click a word, Enter splits the bar there, Backspace at a bar start joins,
 *        Shift+Enter toggles a verse (paragraph) break. Bar-final word auto = end-rhyme.
 *  RHYMES: click two words to rhyme them (same color group); click more to extend;
 *        click a grouped word to remove. Ctrl/Cmd+B/U/I/M set the type on the
 *        selected word: B=end, U=internal, I=slant, M=multisyllabic.
 * Bars + verses + groups + types persist per video (source of truth + labels).
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
  const [paras, setParas] = useState<number[]>([])            // bar indices that start a verse
  const [groups, setGroups] = useState<Record<string, number[]>>({})
  const [types, setTypes] = useState<Record<number, string>>({})  // wordIndex -> type
  const [caret, setCaret] = useState<{ b: number; w: number }>({ b: 0, w: 0 })
  const [selWi, setSelWi] = useState<number | null>(null)    // selected word (rhymes mode)
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

  const gids = useMemo(() => Object.keys(groups), [groups])
  const hueOfGid = (gid: string) => USER_PALETTE[Math.max(0, gids.indexOf(gid)) % USER_PALETTE.length]!
  const gidOfWord = useMemo(() => {
    const m = new Map<number, string>()
    for (const [gid, wis] of Object.entries(groups)) for (const wi of wis) m.set(wi, gid)
    return m
  }, [groups])
  // last word of each bar → auto "end" rhyme
  const barLastWord = useMemo(() => {
    const s = new Set<number>()
    for (const bar of bars) if (bar.length) s.add(bar[bar.length - 1]!)
    return s
  }, [bars])
  const effType = (wi: number) => types[wi] ?? (barLastWord.has(wi) ? 'end' : null)

  // ---- bars mode ----
  function splitAtCaret() {
    setBars((prev) => {
      const bar = prev[caret.b]; if (!bar || caret.w >= bar.length - 1) return prev
      const b = prev.map((x) => [...x]); const after = b[caret.b]!.slice(caret.w + 1)
      b[caret.b] = b[caret.b]!.slice(0, caret.w + 1); b.splice(caret.b + 1, 0, after)
      setParas((p) => p.map((x) => (x > caret.b ? x + 1 : x)))  // keep verse marks aligned
      return b
    })
    setCaret((c) => ({ b: c.b + 1, w: 0 })); setDirty(true)
  }
  function joinWithPrev() {
    if (caret.b === 0 || caret.w !== 0) return
    setBars((prev) => {
      const b = prev.map((x) => [...x]); const prevLen = b[caret.b - 1]!.length
      b[caret.b - 1] = [...b[caret.b - 1]!, ...b[caret.b]!]; b.splice(caret.b, 1)
      setParas((p) => p.filter((x) => x !== caret.b).map((x) => (x > caret.b ? x - 1 : x)))
      setCaret({ b: caret.b - 1, w: prevLen }); return b
    })
    setDirty(true)
  }
  function toggleVerse() {
    if (caret.b === 0) return
    setParas((p) => (p.includes(caret.b) ? p.filter((x) => x !== caret.b) : [...p, caret.b].sort((a, b) => a - b)))
    setDirty(true)
  }

  // ---- rhymes mode ----
  function firstFreeGid(g: Record<string, number[]>) { let n = 0; while (g[`g${n}`]) n++; return `g${n}` }
  function onRhymeClick(wi: number) {
    if (selWi === null) { setSelWi(wi); return }
    if (selWi === wi) { setSelWi(null); return }
    setGroups((g) => {
      const next: Record<string, number[]> = {}
      for (const [gid, wis] of Object.entries(g)) next[gid] = [...wis]
      let gid = [...Object.entries(next)].find(([, wis]) => wis.includes(selWi))?.[0]
      if (!gid) { gid = firstFreeGid(next); next[gid] = [selWi] }
      // if the clicked word is already in this group, remove it (unlink); else add
      if (next[gid]!.includes(wi)) next[gid] = next[gid]!.filter((x) => x !== wi)
      else { for (const id of Object.keys(next)) if (id !== gid) next[id] = next[id]!.filter((x) => x !== wi); next[gid] = [...next[gid]!, wi] }
      for (const id of Object.keys(next)) if (!next[id]!.length) delete next[id]
      return next
    })
    setSelWi(wi); setDirty(true)
  }
  function setType(wi: number, t: string) {
    setTypes((m) => { const n = { ...m }; if (n[wi] === t) delete n[wi]; else n[wi] = t; return n })
    setDirty(true)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (mode === 'bars') {
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); toggleVerse() }
      else if (e.key === 'Enter') { e.preventDefault(); splitAtCaret() }
      else if (e.key === 'Backspace' && caret.w === 0) { e.preventDefault(); joinWithPrev() }
    } else if (mode === 'rhymes' && selWi != null && (e.ctrlKey || e.metaKey)) {
      const t = TYPE_KEYS[e.key.toLowerCase()]
      if (t) { e.preventDefault(); setType(selWi, t) }
    }
  }

  function onWordClick(bi: number, wIdx: number, wi: number) {
    if (mode === 'bars') { setCaret({ b: bi, w: wIdx }); containerRef.current?.focus() }
    else { onRhymeClick(wi); containerRef.current?.focus() }
  }

  async function save() {
    setSaving(true)
    try {
      await api.putAnnotation(videoId, {
        bars, groups, paras,
        types: Object.fromEntries(Object.entries(types).map(([k, v]) => [String(k), v])),
      })
      setDirty(false); setStatus('saved ✓')
    } catch { setStatus('save failed') } finally { setSaving(false) }
  }
  function reset() { setBars(autoSegment()); setParas([]); setCaret({ b: 0, w: 0 }); setDirty(true); setStatus('re-split — save to keep') }
  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

  function wordStyle(wi: number, isCaret: boolean): React.CSSProperties {
    const gid = gidOfWord.get(wi); const t = effType(wi)
    const hue = gid != null ? hueOfGid(gid) : null
    return {
      cursor: 'pointer', padding: '0 3px', borderRadius: 3,
      background: hue != null ? `hsl(${hue} 75% 50% / 0.45)` : undefined,
      fontWeight: t === 'end' ? 700 : 400,
      fontStyle: t === 'slant' ? 'italic' : undefined,
      textDecoration: t === 'internal' ? 'underline' : t === 'multi' ? 'underline' : undefined,
      textDecorationStyle: t === 'multi' ? 'double' : t === 'internal' ? 'dotted' : undefined,
      textUnderlineOffset: '2px',
      outline: (isCaret || selWi === wi) ? '1px solid var(--color-primary)' : undefined,
    }
  }

  const TYPE_HELP = 'B end · U internal · I slant · M multi'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['bars', 'rhymes'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontFamily: MONO, fontSize: '0.72rem', padding: '4px 12px', cursor: 'pointer', border: 'none',
              background: mode === m ? 'var(--color-primary)' : 'transparent', color: mode === m ? '#0a0a0a' : 'var(--color-muted)',
            }}>{m === 'bars' ? '¶ Bars' : '♪ Rhymes'}</button>
          ))}
        </div>
        <span style={{ fontSize: '0.74rem', color: 'var(--color-muted)' }}>
          {mode === 'bars'
            ? <>click · <kbd>Enter</kbd> split bar · <kbd>Shift+Enter</kbd> verse · <kbd>Backspace</kbd> join</>
            : <>click two words to rhyme them · <kbd>Ctrl</kbd>+ {TYPE_HELP}</>}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>{status}</span>
        {mode === 'bars' && <button onClick={reset} style={btn(false)}>Re-split</button>}
        <button onClick={save} disabled={saving || !dirty} style={btn(dirty && !saving)}>{saving ? 'Saving…' : 'Save'}</button>
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
              <p style={{ margin: 0, lineHeight: 1.85 }}>
                {bar.map((wi, wIdx) => {
                  const isCaret = mode === 'bars' && caret.b === bi && caret.w === wIdx
                  return (
                    <span key={wi}>
                      {wIdx > 0 && ' '}
                      <span onClick={() => onWordClick(bi, wIdx, wi)} style={wordStyle(wi, isCaret)}>
                        {meta.get(wi)?.text ?? '?'}
                      </span>
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

function btn(active: boolean): React.CSSProperties {
  return {
    fontFamily: MONO, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 5,
    border: '1px solid var(--color-border)', cursor: active ? 'pointer' : 'default',
    background: active ? 'var(--color-primary)' : 'transparent', color: active ? '#0a0a0a' : 'var(--color-muted)',
  }
}
