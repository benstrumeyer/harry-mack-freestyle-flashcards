import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type VideoSummaryDto } from '../services/api'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

export default function SongsListPage() {
  const [videos, setVideos] = useState<VideoSummaryDto[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getVideos()
      .then(setVideos)
      .catch(() => setVideos([]))
      .finally(() => setLoading(false))
  }, [])

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
    whiteSpace: 'nowrap',
  }

  const numTh: React.CSSProperties = { ...thStyle, textAlign: 'right' }
  const numTd: React.CSSProperties = {
    padding: '0.55rem 0.75rem',
    textAlign: 'right',
    fontFamily: MONO,
    fontSize: '0.78rem',
    color: 'var(--color-muted)',
    whiteSpace: 'nowrap',
  }

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
        <h1 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
          Songs
        </h1>
        {videos.length > 0 && (
          <span style={{ fontFamily: MONO, fontSize: '0.75rem', color: 'var(--color-primary)' }}>
            {videos.length} analyzed
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          loading…
        </div>
      ) : videos.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted)', fontSize: '0.9rem' }}>
          No analyzed songs yet. Process a video on the Pipeline page.
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Artist</th>
                <th style={numTh}>Bars</th>
                <th style={numTh}>Words</th>
                <th style={numTh}>Density</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((v) => (
                <tr key={v.id} style={{ borderBottom: '1px solid rgba(42,42,62,0.5)' }}>
                  <td style={{ padding: '0.55rem 0.75rem' }}>
                    <Link
                      to={`/songs/${v.id}`}
                      style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}
                    >
                      {v.title ?? v.id}
                    </Link>
                  </td>
                  <td style={{ padding: '0.55rem 0.75rem', fontSize: '0.82rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                    {v.artist ?? '—'}
                  </td>
                  <td style={numTd}>{v.barCount}</td>
                  <td style={numTd}>{v.wordCount}</td>
                  <td style={{ ...numTd, color: v.density != null ? 'var(--color-primary)' : 'var(--color-muted)' }}>
                    {v.density != null ? v.density.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
