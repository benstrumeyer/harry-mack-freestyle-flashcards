import { useState, useEffect, useMemo } from 'react'
import { api, type RhymeWordDto, type RhymeMapDto, type BarSourceDto } from '../services/api'
import WordMap from '../components/WordMap'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

type SortKey = 'word' | 'frequency' | 'links'
type SortDir = 'asc' | 'desc'

function fmtTimestamp(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function ytLink(youtubeId: string, timestampSeconds: number | null): string {
  const base = `https://www.youtube.com/watch?v=${youtubeId}`
  return timestampSeconds != null ? `${base}&t=${Math.floor(timestampSeconds)}s` : base
}

function SourcesPanel({ word }: { word: string }) {
  const [sources, setSources] = useState<BarSourceDto[] | null>(null)

  useEffect(() => {
    api.getRhymeSources(word)
      .then(setSources)
      .catch(() => setSources([]))
  }, [word])

  if (sources === null) {
    return <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>Loading sources…</p>
  }
  if (sources.length === 0) {
    return <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>No source videos found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {sources.map((src, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          {src.youtubeId ? (
            <a
              href={ytLink(src.youtubeId, src.timestampSeconds)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: MONO,
                fontSize: '0.75rem',
                color: 'var(--color-primary)',
                textDecoration: 'none',
                flexShrink: 0,
                paddingTop: '0.05rem',
              }}
            >
              {src.timestampSeconds != null ? fmtTimestamp(src.timestampSeconds) : '▶'}
            </a>
          ) : (
            <span style={{ fontFamily: MONO, fontSize: '0.75rem', color: 'var(--color-muted)', flexShrink: 0, paddingTop: '0.05rem' }}>
              {src.timestampSeconds != null ? fmtTimestamp(src.timestampSeconds) : '—'}
            </span>
          )}
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
              {src.videoTitle ?? src.videoUrl ?? 'Unknown'}
            </span>
            {src.barText && (
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.78rem', color: 'var(--color-text)', fontStyle: 'italic', lineHeight: 1.4 }}>
                "{src.barText}"
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function RhymeDictionaryPage() {
  const [words, setWords] = useState<RhymeWordDto[]>([])
  const [map, setMap] = useState<RhymeMapDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('links')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showMap, setShowMap] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedWord, setExpandedWord] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getRhymes(), api.getRhymeMap()])
      .then(([w, m]) => { setWords(w); setMap(m) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Build adjacency: word → list of rhyme words
  const rhymesFor = useMemo(() => {
    const m = new Map<string, string[]>()
    if (!map) return m
    for (const edge of map.edges) {
      if (!m.has(edge.wordA)) m.set(edge.wordA, [])
      if (!m.has(edge.wordB)) m.set(edge.wordB, [])
      m.get(edge.wordA)!.push(edge.wordB)
      m.get(edge.wordB)!.push(edge.wordA)
    }
    return m
  }, [map])

  const linksCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const [word, rhymes] of rhymesFor) m.set(word, rhymes.length)
    return m
  }, [rhymesFor])

  const sortedWords = useMemo(() => {
    const filtered = search
      ? words.filter(w => w.word.toLowerCase().includes(search.toLowerCase()))
      : words
    return [...filtered].sort((a, b) => {
      let va: number | string
      let vb: number | string
      if (sortKey === 'word') { va = a.word; vb = b.word }
      else if (sortKey === 'frequency') { va = a.frequency; vb = b.frequency }
      else { va = linksCount.get(a.word) ?? 0; vb = linksCount.get(b.word) ?? 0 }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [words, sortKey, sortDir, linksCount, search])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortArrow = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <span style={{ opacity: 0.25, marginLeft: 4 }}>⇅</span>
    return <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const thStyle = (align: 'left' | 'right' | 'center' = 'left'): React.CSSProperties => ({
    padding: '0.6rem 0.75rem',
    textAlign: align,
    fontSize: '0.68rem',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--color-muted)',
    background: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    userSelect: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 45px)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '0.65rem 1.25rem',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
      }}>
        <h1 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--color-muted)', flexShrink: 0 }}>
          Rhyme Dictionary
        </h1>
        {words.length > 0 && (
          <span style={{ fontFamily: MONO, fontSize: '0.75rem', color: 'var(--color-primary)', flexShrink: 0 }}>
            {words.length} words
          </span>
        )}
        <input
          type="text"
          placeholder="Filter…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            marginLeft: 'auto',
            width: '180px',
            padding: '0.35rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            fontSize: '0.85rem',
            outline: 'none',
            fontFamily: MONO,
          }}
        />
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          loading…
        </div>
      ) : words.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted)', fontSize: '0.9rem' }}>
          No rhyme words yet. Process a transcript on the Pipeline page.
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle('left'), width: '120px' }} onClick={() => handleSort('word')}>
                    WORD <SortArrow k="word" />
                  </th>
                  <th style={{ ...thStyle('right'), width: '60px' }} onClick={() => handleSort('frequency')}>
                    FREQ <SortArrow k="frequency" />
                  </th>
                  <th style={{ ...thStyle('right'), width: '60px' }} onClick={() => handleSort('links')}>
                    LINKS <SortArrow k="links" />
                  </th>
                  <th style={{ ...thStyle('left'), cursor: 'default' }}>
                    RHYMES WITH
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedWords.flatMap((w) => {
                  const rhymes = rhymesFor.get(w.word) ?? []
                  const links = rhymes.length
                  const isExpanded = expandedWord === w.word
                  const rows = [
                    <tr
                      key={w.id}
                      onClick={() => setExpandedWord(v => v === w.word ? null : w.word)}
                      style={{ borderBottom: isExpanded ? 'none' : '1px solid rgba(42,42,62,0.5)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '0.55rem 0.75rem', fontFamily: MONO, fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                        {w.word}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', fontFamily: MONO, fontSize: '0.78rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                        {w.frequency}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', fontFamily: MONO, fontSize: '0.78rem', color: links > 0 ? 'var(--color-primary)' : 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                        {links}
                      </td>
                      <td style={{ padding: '0.4rem 0.75rem' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                          {rhymes.length === 0 ? (
                            <span style={{ fontFamily: MONO, fontSize: '0.75rem', color: 'rgba(136,136,136,0.4)' }}>—</span>
                          ) : (
                            rhymes.map(r => (
                              <span
                                key={r}
                                style={{
                                  fontFamily: MONO,
                                  fontSize: '0.78rem',
                                  background: 'var(--color-surface)',
                                  border: '1px solid var(--color-border)',
                                  color: 'var(--color-text)',
                                  padding: '0.15rem 0.55rem',
                                  borderRadius: '999px',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {r}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ]

                  if (isExpanded) {
                    rows.push(
                      <tr key={w.id + '-sources'} style={{ borderBottom: '1px solid rgba(42,42,62,0.5)' }}>
                        <td colSpan={4} style={{ padding: '0 0.75rem 0.75rem 1.5rem' }}>
                          <p style={{ margin: '0 0 0.4rem', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
                            Video Sources
                          </p>
                          <SourcesPanel word={w.word} />
                        </td>
                      </tr>
                    )
                  }

                  return rows
                })}
              </tbody>
            </table>
          </div>

          {/* Collapsible word map */}
          {map && map.nodes.length > 0 && (
            <div style={{ borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
              <button
                onClick={() => setShowMap(v => !v)}
                style={{
                  width: '100%',
                  padding: '0.55rem 1rem',
                  background: 'var(--color-surface)',
                  border: 'none',
                  color: 'var(--color-muted)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>WORD MAP</span>
                <span style={{ fontFamily: MONO, fontSize: '0.7rem' }}>{showMap ? '▲' : '▼'}</span>
              </button>
              {showMap && (
                <div style={{ height: '300px', overflow: 'hidden' }}>
                  <WordMap nodes={map.nodes} edges={map.edges} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
