import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoAnalysisDto } from '../services/api'
import { api } from '../services/api'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"
const PALETTE = [8, 205, 130, 45, 280, 165, 95, 320, 235, 58, 300, 185]
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const TYPE_KEYS: Record<string, string> = { z: 'internal', x: 'slant', c: 'multi' }

interface Props { analysis: VideoAnalysisDto; videoId: string }
type Pos = { b: number; w: number }

/**
 * One-handed, modeless rap-annotation editor (per council synthesis).
 * Groups are PHONETIC families keyed by the actual rhyme sound (from the analysis
 * rhyme keys) — labeled sound + letter + stable color, not arbitrary numbers.
 * Left-hand keys: W/A/S/D move · Space groups the cursor word with same-sounding
 * words · Q/E cycle the active family · R new (slant) family · F split bar /
 * Shift+F join · T verse · Z/X/C = internal/slant/multi type. Arrows/Enter/Backspace
 * also work. Persists bars+verses+groups(by sound)+types per video.
 */
export default function BarEditor({ analysis, videoId }: Props) {
  const words = useMemo(() => [...analysis.words].sort((a, b) => a.wordIndex - b.wordIndex), [analysis.words])
  const meta = useMemo(() => {
    const m = new Map<number, { text: string; start: number }>()
    for (const w of words) m.set(w.wordIndex, { text: w.text, start: w.start })
    return m
  }, [words])
  // machine phonetic key per word (canonical rhyme tail, else delivered) — the sound.
  const autoKey = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of analysis.events) {
      const k = e.canonicalKey || e.deliveredKey
      if (k) m.set(e.wordIndex, k)
    }
    return m
  }, [analysis.events])

  const [bars, setBars] = useState<number[][]>([])
  const [paras, setParas] = useState<number[]>([])
  const [groups, setGroups] = useState<Record<string, number[]>>({}) // key = rhyme sound (or u#)
  const [types, setTypes] = useState<Record<number, string>>({})
  const [cur, setCur] = useState<Pos>({ b: 0, w: 0 })
  const [active, setActive] = useState<string | null>(null) // active family key
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const autoSegment = useMemo(() => (): number[][] => {
    const out: number[][] = []; let c: number[] = []
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!; c.push(w.wordIndex)
      const next = words[i + 1]; const gap = next ? next.start - w.end : Infinity
      if ((c.length >= 2 && (/[.?!]$/.test(w.text) || gap > 0.5)) || !next) { out.push(c); c = [] }
    }
    if (c.length) out.push(c)
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
      setStatus(a && a.bars.length ? 'loaded your saved annotation' : 'auto-split — Space to group rhymes')
    }).catch(() => { if (!cancelled) { setBars(autoSegment()); setStatus('auto-split — Space to group rhymes') } })
    return () => { cancelled = true }
  }, [videoId, autoSegment])

  // family display order (first appearance) → color + letter + sound label
  const families = useMemo(() => {
    const firstIdx = (wis: number[]) => (wis.length ? Math.min(...wis) : Infinity)
    const order = Object.keys(groups).sort((a, b) => firstIdx(groups[a]!) - firstIdx(groups[b]!))
    const info = new Map<string, { hue: number; letter: string; label: string }>()
    order.forEach((k, i) => {
      const label = k.startsWith('u') && /^u\d+$/.test(k) ? '(slant)' : `/${k}/`
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
  const effType = (wi: number) => types[wi] ?? (barLast.has(wi) ? 'end' : null)
  const wiAt = (p: Pos): number | null => bars[p.b]?.[p.w] ?? null
  const curWi = wiAt(cur)

  // ---- navigation ----
  const clampW = (b: number, w: number) => Math.max(0, Math.min(w, (bars[b]?.length ?? 1) - 1))
  function move(d: 'left' | 'right' | 'up' | 'down') {
    setCur((c) => {
      if (d === 'left') return c.w > 0 ? { b: c.b, w: c.w - 1 } : c.b > 0 ? { b: c.b - 1, w: (bars[c.b - 1]?.length ?? 1) - 1 } : c
      if (d === 'right') return c.w < (bars[c.b]?.length ?? 1) - 1 ? { b: c.b, w: c.w + 1 } : c.b < bars.length - 1 ? { b: c.b + 1, w: 0 } : c
      if (d === 'up' && c.b > 0) return { b: c.b - 1, w: clampW(c.b - 1, c.w) }
      if (d === 'down' && c.b < bars.length - 1) return { b: c.b + 1, w: clampW(c.b + 1, c.w) }
      return c
    })
  }

  // ---- bars ----
  function splitAtCur() {
    setBars((prev) => {
      const bar = prev[cur.b]; if (!bar || cur.w >= bar.length - 1) return prev
      const b = prev.map((x) => [...x]); const after = b[cur.b]!.slice(cur.w + 1)
      b[cur.b] = b[cur.b]!.slice(0, cur.w + 1); b.splice(cur.b + 1, 0, after)
      setParas((p) => p.map((x) => (x > cur.b ? x + 1 : x))); return b
    })
    setCur((c) => ({ b: c.b + 1, w: 0 })); setDirty(true)
  }
  function joinPrev() {
    if (cur.b === 0 || cur.w !== 0) return
    setBars((prev) => {
      const b = prev.map((x) => [...x]); const pl = b[cur.b - 1]!.length
      b[cur.b - 1] = [...b[cur.b - 1]!, ...b[cur.b]!]; b.splice(cur.b, 1)
      setParas((p) => p.filter((x) => x !== cur.b).map((x) => (x > cur.b ? x - 1 : x)))
      setCur({ b: cur.b - 1, w: pl }); return b
    })
    setDirty(true)
  }
  function toggleVerse() {
    if (cur.b === 0) return
    setParas((p) => (p.includes(cur.b) ? p.filter((x) => x !== cur.b) : [...p, cur.b].sort((a, b) => a - b))); setDirty(true)
  }

  // ---- phonetic grouping ----
  function groupCursor() {
    if (curWi == null) return
    const target = active ?? autoKey.get(curWi) // paint into active family, else the word's own sound
    if (!target) { setStatus('no rhyme sound detected for this word — press R for a manual family'); return }
    setGroups((g) => {
      const next: Record<string, number[]> = {}
      for (const [k, wis] of Object.entries(g)) next[k] = [...wis]
      const had = next[target]?.includes(curWi)
      for (const k of Object.keys(next)) next[k] = next[k]!.filter((x) => x !== curWi)
      if (!had) next[target] = [...(next[target] ?? []), curWi]
      for (const k of Object.keys(next)) if (!next[k]!.length) delete next[k]
      return next
    })
    setActive(target); setDirty(true)
  }
  function cycleFamily(dir: 1 | -1) {
    const ks = families.order
    if (!ks.length) { setActive(null); return }
    const i = active ? ks.indexOf(active) : -1
    setActive(ks[((i + dir) % ks.length + ks.length) % ks.length]!)
  }
  function newSlantFamily() {
    let n = 0; while (groups[`u${n}`]) n++
    const fid = `u${n}`; setGroups((g) => ({ ...g, [fid]: curWi != null ? [curWi] : [] })); setActive(fid); setDirty(true)
  }
  function setType(wi: number, t: string) {
    setTypes((m) => { const n = { ...m }; if (n[wi] === t) delete n[wi]; else n[wi] = t; return n }); setDirty(true)
  }
  function toggleOpener() { if (curWi != null) setType(curWi, 'opener') }

  // ---- delete (also how you exclude off-song chatter: delete those bars, save) ----
  function purgeWords(remove: Set<number>) {
    setGroups((g) => { const n: Record<string, number[]> = {}; for (const [k, wis] of Object.entries(g)) { const f = wis.filter((x) => !remove.has(x)); if (f.length) n[k] = f } return n })
    setTypes((m) => { const n = { ...m }; for (const wi of remove) delete n[wi]; return n })
  }
  function deleteWord() {
    if (curWi == null) return
    const wi = curWi; const barEmptied = (bars[cur.b]?.length ?? 0) <= 1
    setBars((prev) => {
      const b = prev.map((x) => [...x]); b[cur.b] = b[cur.b]!.filter((_, i) => i !== cur.w)
      if (!b[cur.b]!.length) b.splice(cur.b, 1); return b
    })
    if (barEmptied) setParas((p) => p.filter((x) => x !== cur.b).map((x) => (x > cur.b ? x - 1 : x)))
    purgeWords(new Set([wi]))
    setCur((c) => barEmptied ? { b: Math.max(0, Math.min(c.b, bars.length - 2)), w: 0 } : { b: c.b, w: Math.max(0, Math.min(c.w, (bars[c.b]?.length ?? 1) - 2)) })
    setDirty(true)
  }
  function deleteBar() {
    const wis = new Set(bars[cur.b] ?? [])
    setBars((prev) => { const b = prev.map((x) => [...x]); b.splice(cur.b, 1); return b })
    setParas((p) => p.filter((x) => x !== cur.b).map((x) => (x > cur.b ? x - 1 : x)))
    purgeWords(wis)
    setCur((c) => ({ b: Math.max(0, Math.min(c.b, bars.length - 2)), w: 0 })); setDirty(true)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const k = e.key
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const nav: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      a: 'left', d: 'right', w: 'up', s: 'down',
    }
    if (nav[k]) { e.preventDefault(); move(nav[k]!); return }
    if (k === ' ') { e.preventDefault(); groupCursor(); return }
    if (k === 'q') { e.preventDefault(); cycleFamily(-1); return }
    if (k === 'e') { e.preventDefault(); cycleFamily(1); return }
    if (k === 'r') { e.preventDefault(); newSlantFamily(); return }
    if (k === 'f') { e.preventDefault(); e.shiftKey ? joinPrev() : splitAtCur(); return }
    if (k === 't') { e.preventDefault(); toggleVerse(); return }
    if (k === 'o') { e.preventDefault(); toggleOpener(); return }
    if (TYPE_KEYS[k] && curWi != null) { e.preventDefault(); setType(curWi, TYPE_KEYS[k]!); return }
    if (k === 'G' || (k === 'Delete' && e.shiftKey)) { e.preventDefault(); deleteBar(); return }
    if (k === 'g' || k === 'Delete') { e.preventDefault(); deleteWord(); return }
    // right-hand fallbacks
    if (k === 'Enter' && e.shiftKey) { e.preventDefault(); toggleVerse(); return }
    if (k === 'Enter') { e.preventDefault(); splitAtCur(); return }
    if (k === 'Backspace' && cur.w === 0) { e.preventDefault(); joinPrev(); return }
  }

  function onWordClick(b: number, w: number, wi: number) {
    setCur({ b, w }); containerRef.current?.focus()
    if (wi === curWi) groupCursor() // click a word twice → group it (mouse path)
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
    const gid = gidOfWord.get(wi); const t = effType(wi)
    const hue = gid != null ? families.info.get(gid)?.hue ?? null : null
    const opener = t === 'opener'
    return {
      cursor: 'pointer', padding: '0 3px', borderRadius: 3,
      background: hue != null ? `hsl(${hue} 75% 50% / 0.42)` : (opener ? 'rgba(120,180,255,0.14)' : (isCur ? 'rgba(255,255,255,0.08)' : undefined)),
      fontWeight: t === 'end' ? 700 : 400, fontStyle: t === 'slant' ? 'italic' : undefined,
      textDecoration: t === 'internal' || t === 'multi' ? 'underline' : undefined,
      textDecorationStyle: t === 'multi' ? 'double' : t === 'internal' ? 'dotted' : undefined, textUnderlineOffset: '2px',
      boxShadow: opener ? 'inset 0 -2px 0 0 var(--color-primary)' : undefined,
      outline: isCur ? '2px solid var(--color-primary)' : undefined,
    }
  }

  const activeInfo = active ? families.info.get(active) : null
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.74rem', color: 'var(--color-muted)' }}>
          <kbd>WASD</kbd> move · <kbd>Space</kbd> rhyme · <kbd>Q/E</kbd> family · <kbd>R</kbd> slant · <kbd>F</kbd> split · <kbd>T</kbd> verse · <kbd>O</kbd> opener · <kbd>G</kbd> del word / <kbd>Shift+G</kbd> del bar · <kbd>Z/X/C</kbd> internal/slant/multi
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>{status}</span>
        <button onClick={reset} style={btn(false)}>Re-split</button>
        <button onClick={save} disabled={saving || !dirty} style={btn(dirty && !saving)}>{saving ? 'Saving…' : 'Save'}</button>
      </div>

      {/* Phonetic-family legend: each family = a rhyme SOUND, letter + color (never color-only). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap', fontSize: '0.72rem' }}>
        <span style={{ color: 'var(--color-muted)', fontFamily: MONO }}>Rhyme families:</span>
        {families.order.length === 0 && <span style={{ color: 'var(--color-muted)' }}>none yet — cursor a word, press Space</span>}
        {families.order.map((k) => {
          const f = families.info.get(k)!
          return (
            <button key={k} onClick={() => setActive(k)} title={`family ${f.letter} = ${f.label} (${groups[k]!.length})`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
              fontFamily: MONO, fontSize: '0.7rem', color: '#0a0a0a', fontWeight: 700,
              background: `hsl(${f.hue} 75% 50% / 0.9)`,
              border: active === k ? '2px solid var(--color-primary)' : '2px solid transparent',
            }}>{f.letter} {f.label} ·{groups[k]!.length}</button>
          )
        })}
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--color-muted)' }}>
          active: {activeInfo ? `${activeInfo.letter} ${activeInfo.label}` : (curWi != null && autoKey.get(curWi) ? `auto /${autoKey.get(curWi)}/` : '—')}
          {' · types: '}<b>bold</b>=end <i>italic</i>=slant <u>internal</u>
        </span>
      </div>

      <div ref={containerRef} tabIndex={0} onKeyDown={onKeyDown} style={{
        display: 'flex', flexDirection: 'column', outline: 'none',
        border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.5rem 0.6rem',
      }}>
        {bars.map((bar, bi) => (
          <div key={bi}>
            {paras.includes(bi) && bi > 0 && <div style={{ height: 1, background: 'var(--color-border)', margin: '0.7rem 0 0.5rem', marginLeft: '3.2rem' }} />}
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', padding: '0.08rem 0' }}>
              <span style={{ width: '2.6rem', flexShrink: 0, textAlign: 'right', fontFamily: MONO, fontSize: '0.7rem', color: 'var(--color-muted)' }}>
                {bar.length ? fmt(meta.get(bar[0]!)?.start ?? 0) : ''}
              </span>
              <p style={{ margin: 0, lineHeight: 1.9 }}>
                {bar.map((wi, wIdx) => {
                  const gid = gidOfWord.get(wi); const letter = gid != null ? families.info.get(gid)?.letter : null
                  return (
                    <span key={wi}>
                      {wIdx > 0 && ' '}
                      <span onClick={() => onWordClick(bi, wIdx, wi)} style={wordStyle(wi, cur.b === bi && cur.w === wIdx)}>
                        {meta.get(wi)?.text ?? '?'}{letter && <sub style={{ fontFamily: MONO, fontSize: '0.6em', opacity: 0.8 }}>{letter}</sub>}
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
