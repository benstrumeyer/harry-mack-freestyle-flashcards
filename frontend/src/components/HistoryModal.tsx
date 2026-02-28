import { useState, useEffect } from 'react'
import { api, type SessionDto } from '../services/api'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function HistoryModal({ isOpen, onClose }: Props) {
  const [sessions, setSessions] = useState<SessionDto[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    api.getSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '480px',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>History</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-muted)',
              fontSize: '1.3rem',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '0.2rem',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '0.75rem' }}>
          {loading ? (
            <p style={{ color: 'var(--color-muted)', padding: '0.5rem' }}>Loading…</p>
          ) : sessions.length === 0 ? (
            <p style={{ color: 'var(--color-muted)', padding: '0.5rem' }}>No sessions yet.</p>
          ) : (
            sessions.map(s => (
              <div
                key={s.id}
                onClick={() => setExpandedId(id => (id === s.id ? null : s.id))}
                style={{
                  padding: '0.75rem',
                  borderRadius: '8px',
                  marginBottom: '0.4rem',
                  background: 'rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.88rem' }}>
                    {new Date(s.startedAt).toLocaleString()}
                  </span>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--color-muted)',
                      marginLeft: '0.5rem',
                    }}
                  >
                    {s.cardsShown.length} cards
                  </span>
                </div>
                {expandedId === s.id && (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
                    {s.cardsShown.length} cards shown in this session.
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
