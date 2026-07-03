import { useState, useEffect, useRef } from 'react'
import { api, type OpenerDto, type SavedOpenerDto, type BarSourceDto } from '../services/api'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

type Tab = 'all' | 'saved'

function fmtTimestamp(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function ytLink(youtubeId: string, timestampSeconds: number | null): string {
  const base = `https://www.youtube.com/watch?v=${youtubeId}`
  return timestampSeconds != null ? `${base}&t=${Math.floor(timestampSeconds)}s` : base
}

function SourcesPanel({ openerId }: { openerId: string }) {
  const [sources, setSources] = useState<BarSourceDto[] | null>(null)

  useEffect(() => {
    api.getOpenerSources(openerId)
      .then(setSources)
      .catch(() => setSources([]))
  }, [openerId])

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

export default function OpenerDictionaryPage() {
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [openers, setOpeners] = useState<OpenerDto[]>([])
  const [savedOpeners, setSavedOpeners] = useState<SavedOpenerDto[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [allEditingId, setAllEditingId] = useState<string | null>(null)
  const [allEditText, setAllEditText] = useState('')
  const [savedEditingId, setSavedEditingId] = useState<string | null>(null)
  const [savedEditText, setSavedEditText] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const savedOpenerIds = new Set(savedOpeners.map(s => s.openerId).filter(Boolean) as string[])
  const savedByOpenerId = new Map(savedOpeners.filter(s => s.openerId).map(s => [s.openerId!, s]))

  useEffect(() => {
    api.getSavedOpeners().then(setSavedOpeners).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab !== 'all') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      api.getOpeners(search || undefined)
        .then(setOpeners)
        .catch(() => setOpeners([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search, tab])

  const saveOpener = async (opener: OpenerDto) => {
    try {
      const saved = await api.saveOpener(opener.id, opener.text)
      setSavedOpeners(prev => [saved, ...prev])
    } catch { /* ignore */ }
  }


  const removeSaved = async (id: string) => {
    try {
      await api.unsaveOpener(id)
      setSavedOpeners(prev => prev.filter(s => s.id !== id))
    } catch { /* ignore */ }
  }

  const deleteOpener = async (opener: OpenerDto, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.deleteOpener(opener.id)
      setOpeners(prev => prev.filter(o => o.id !== opener.id))
      const saved = savedByOpenerId.get(opener.id)
      if (saved) setSavedOpeners(prev => prev.filter(s => s.id !== saved.id))
    } catch { /* ignore */ }
  }

  const startAllEdit = (opener: OpenerDto, e: React.MouseEvent) => {
    e.stopPropagation()
    setAllEditingId(opener.id)
    setAllEditText(opener.text)
  }

  const commitAllEdit = (id: string) => {
    const trimmed = allEditText.trim()
    if (trimmed) setOpeners(prev => prev.map(o => o.id === id ? { ...o, text: trimmed } : o))
    setAllEditingId(null)
  }

  const startSavedEdit = (s: SavedOpenerDto, e: React.MouseEvent) => {
    e.stopPropagation()
    setSavedEditingId(s.id)
    setSavedEditText(s.text)
  }

  const commitSavedEdit = async (id: string) => {
    const trimmed = savedEditText.trim()
    if (!trimmed) { setSavedEditingId(null); return }
    try {
      const updated = await api.updateSavedOpener(id, trimmed)
      setSavedOpeners(prev => prev.map(s => s.id === id ? updated : s))
    } catch { /* ignore */ }
    setSavedEditingId(null)
  }

  const unsavedOpeners = openers.filter(o => !savedOpenerIds.has(o.id))

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.35rem 0.9rem',
    borderRadius: '999px',
    border: '1px solid var(--color-border)',
    background: active ? 'var(--color-primary)' : 'var(--color-surface)',
    color: active ? '#fff' : 'var(--color-muted)',
    fontSize: '0.78rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    cursor: 'pointer',
  })

  const thStyle: React.CSSProperties = {
    padding: '0.6rem 0.75rem',
    textAlign: 'left',
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
  }

  const editInputStyle: React.CSSProperties = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--color-primary)',
    color: 'var(--color-text)',
    fontSize: '0.9rem',
    fontWeight: 500,
    outline: 'none',
    padding: '0.1rem 0',
    fontFamily: 'inherit',
  }

  const iconBtn: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-muted)',
    cursor: 'pointer',
    fontSize: '0.9rem',
    padding: '0.2rem 0.4rem',
    lineHeight: 1,
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 45px)', overflow: 'hidden' }}>

      {/* Header bar */}
      <div style={{
        padding: '0.65rem 1.25rem',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
      }}>
        <h1 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--color-muted)', flexShrink: 0 }}>
          Opener Dictionary
        </h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button style={tabStyle(tab === 'all')} onClick={() => setTab('all')}>All</button>
          <button style={tabStyle(tab === 'saved')} onClick={() => setTab('saved')}>
            ★ Saved{savedOpeners.length > 0 ? ` (${savedOpeners.length})` : ''}
          </button>
        </div>
        {tab === 'all' && (
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              marginLeft: 'auto',
              width: '220px',
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
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* ── SAVED TAB ── */}
        {tab === 'saved' ? (
          savedOpeners.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontFamily: MONO, fontSize: '0.75rem', letterSpacing: '0.15em', color: 'rgba(136,136,136,0.5)', textTransform: 'uppercase' }}>no saved openers</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>Star an opener in the All tab</div>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>OPENER</th>
                    <th style={{ ...thStyle, width: '140px' }}>SAVED</th>
                    <th style={{ ...thStyle, width: '48px', textAlign: 'center' }}>–</th>
                  </tr>
                </thead>
                <tbody>
                  {savedOpeners.map((s) => (
                    <tr
                      key={s.id}
                      style={{ borderBottom: '1px solid rgba(42,42,62,0.5)' }}
                    >
                      <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle' }}>
                        {savedEditingId === s.id ? (
                          <input
                            autoFocus
                            value={savedEditText}
                            onChange={e => setSavedEditText(e.target.value)}
                            onBlur={() => commitSavedEdit(s.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitSavedEdit(s.id)
                              if (e.key === 'Escape') setSavedEditingId(null)
                            }}
                            style={editInputStyle}
                          />
                        ) : (
                          <span
                            style={{ fontWeight: 500, fontSize: '0.9rem', cursor: 'text', lineHeight: 1.5 }}
                            onClick={e => startSavedEdit(s, e)}
                            title="Click to edit"
                          >
                            {s.text}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontFamily: MONO, fontSize: '0.75rem', color: 'var(--color-muted)', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        {formatDate(s.savedAt)}
                      </td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center', verticalAlign: 'middle' }}>
                        <button onClick={() => removeSaved(s.id)} title="Remove" style={iconBtn}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* ── ALL TAB ── */
          loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
              loading…
            </div>
          ) : unsavedOpeners.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem' }}>
              {search
                ? 'No openers match your search.'
                : openers.length === 0
                ? 'No openers yet. Process a transcript on the Pipeline page.'
                : 'All openers have been saved.'}
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>OPENER</th>
                    <th style={{ ...thStyle, width: '80px', textAlign: 'center' }}>FREQ</th>
                    <th style={{ ...thStyle, width: '44px', textAlign: 'center' }}>SAVE</th>
                    <th style={{ ...thStyle, width: '44px', textAlign: 'center' }}>DEL</th>
                  </tr>
                </thead>
                <tbody>
                  {unsavedOpeners.flatMap(opener => {
                    const isExpanded = expandedId === opener.id
                    const rows = [
                      <tr
                        key={opener.id}
                        onClick={() => allEditingId !== opener.id && setExpandedId(id => id === opener.id ? null : opener.id)}
                        style={{
                          borderBottom: isExpanded ? 'none' : '1px solid rgba(42,42,62,0.5)',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle' }}>
                          {allEditingId === opener.id ? (
                            <input
                              autoFocus
                              value={allEditText}
                              onChange={e => setAllEditText(e.target.value)}
                              onBlur={() => commitAllEdit(opener.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitAllEdit(opener.id)
                                if (e.key === 'Escape') setAllEditingId(null)
                              }}
                              onClick={e => e.stopPropagation()}
                              style={editInputStyle}
                            />
                          ) : (
                            <span
                              style={{ fontWeight: 500, fontSize: '0.9rem', cursor: 'text', lineHeight: 1.5 }}
                              onClick={e => startAllEdit(opener, e)}
                              title="Click to edit"
                            >
                              {opener.text}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center', verticalAlign: 'middle' }}>
                          <span style={{
                            fontFamily: MONO,
                            fontSize: '0.72rem',
                            background: 'var(--color-secondary)',
                            color: 'var(--color-text)',
                            padding: '0.18rem 0.5rem',
                            borderRadius: '999px',
                          }}>
                            ×{opener.frequency}
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center', verticalAlign: 'middle' }}>
                          <button
                            onClick={e => { e.stopPropagation(); saveOpener(opener) }}
                            title="Save opener"
                            style={{ ...iconBtn, fontSize: '1rem' }}
                          >
                            ☆
                          </button>
                        </td>
                        <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center', verticalAlign: 'middle' }}>
                          <button
                            onClick={e => deleteOpener(opener, e)}
                            title="Delete opener"
                            style={{ ...iconBtn, fontSize: '0.8rem' }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ]

                    if (isExpanded) {
                      rows.push(
                        <tr key={opener.id + '-detail'} style={{ borderBottom: '1px solid rgba(42,42,62,0.5)' }}>
                          <td colSpan={4} style={{ padding: '0 0.75rem 0.75rem 1.5rem' }}>
                            {opener.exampleCompletions.length > 0 && (
                              <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1rem', color: 'var(--color-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>
                                {opener.exampleCompletions.map((ex, i) => (
                                  <li key={i} style={{ marginBottom: '0.25rem' }}>{ex}</li>
                                ))}
                              </ul>
                            )}
                            <div style={{ borderTop: opener.exampleCompletions.length > 0 ? '1px solid var(--color-border)' : 'none', paddingTop: opener.exampleCompletions.length > 0 ? '0.6rem' : 0 }}>
                              <p style={{ margin: '0 0 0.4rem', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
                                Video Sources
                              </p>
                              <SourcesPanel openerId={opener.id} />
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    return rows
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  )
}
