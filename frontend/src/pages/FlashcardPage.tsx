import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type RhymeWordDto, type SavedOpenerDto } from '../services/api'
import HistoryModal from '../components/HistoryModal'

type Mode = 'openers' | 'rhymes'
type Card = { id: string; text: string; mode: Mode }

export default function FlashcardPage() {
  const [mode, setMode] = useState<Mode>('openers')
  const [card, setCard] = useState<Card | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [savedOpeners, setSavedOpeners] = useState<SavedOpenerDto[]>([])
  const [rhymeWords, setRhymeWords] = useState<RhymeWordDto[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)
  const sessionCards = useRef<string[]>([])

  useEffect(() => {
    Promise.all([api.getSavedOpeners(), api.getRhymes()])
      .then(([openers, rhymes]) => {
        setSavedOpeners(openers)
        setRhymeWords(rhymes)
        setDataLoaded(true)
      })
      .catch(() => setDataLoaded(true))
  }, [])

  const pickCard = useCallback((openers: SavedOpenerDto[], rhymes: RhymeWordDto[], currentMode: Mode): Card | null => {
    if (currentMode === 'openers') {
      if (openers.length === 0) return null
      const pick = openers[Math.floor(Math.random() * openers.length)]
      sessionCards.current.push(pick.id)
      return { id: pick.id, text: pick.text, mode: 'openers' }
    } else {
      if (rhymes.length === 0) return null
      const pick = rhymes[Math.floor(Math.random() * rhymes.length)]
      sessionCards.current.push(pick.id)
      return { id: pick.id, text: pick.word, mode: 'rhymes' }
    }
  }, [])

  // Show first card once data has loaded
  useEffect(() => {
    if (dataLoaded) {
      setCard(pickCard(savedOpeners, rhymeWords, mode))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded])

  const advance = useCallback(() => {
    setCard(pickCard(savedOpeners, rhymeWords, mode))
  }, [pickCard, savedOpeners, rhymeWords, mode])

  // Reset card when mode switches
  useEffect(() => {
    if (dataLoaded) {
      setCard(pickCard(savedOpeners, rhymeWords, mode))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Save session on unmount
  useEffect(() => {
    return () => {
      if (sessionCards.current.length > 0) {
        api.createSession(sessionCards.current).catch(() => {})
        sessionCards.current = []
      }
    }
  }, [])

  const toggleMode = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMode(m => (m === 'openers' ? 'rhymes' : 'openers'))
  }

  const openHistory = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowHistory(true)
  }

  const unsaveAndAdvance = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!card || mode !== 'openers') return
    try {
      await api.unsaveOpener(card.id)
      const remaining = savedOpeners.filter(s => s.id !== card.id)
      setSavedOpeners(remaining)
      setCard(pickCard(remaining, rhymeWords, mode))
    } catch { /* ignore */ }
  }

  const noCard = dataLoaded && card === null
  const notLoaded = !dataLoaded

  return (
    <div
      onClick={advance}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
        padding: '2rem',
        minHeight: 'calc(100vh - 45px)',
        background: 'var(--color-bg)',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          position: 'absolute',
          top: '1rem',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0 1.25rem',
        }}
      >
        <button
          onClick={toggleMode}
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-primary)',
            padding: '0.4rem 0.9rem',
            borderRadius: '999px',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {mode === 'openers' ? 'Sentence Starters' : 'Rhyme Words'}
        </button>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {mode === 'openers' && card && (
            <button
              onClick={unsaveAndAdvance}
              title="Remove from saved"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-muted)',
                padding: '0.4rem 0.75rem',
                borderRadius: '999px',
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              ★
            </button>
          )}
          <button
            onClick={openHistory}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-muted)',
              padding: '0.4rem 0.9rem',
              borderRadius: '999px',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            History
          </button>
        </div>
      </div>

      {/* Card */}
      {notLoaded ? (
        <div style={{ color: 'var(--color-muted)', fontSize: '1rem' }}>…</div>
      ) : noCard ? (
        <div style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
          {mode === 'openers' ? (
            <>
              <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>No saved openers yet.</p>
              <p style={{ fontSize: '0.9rem' }}>
                Star openers from the{' '}
                <a
                  href="/openers"
                  onClick={e => e.stopPropagation()}
                  style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
                >
                  Openers
                </a>{' '}
                page to add them here.
              </p>
            </>
          ) : (
            <p style={{ fontSize: '1.2rem' }}>No rhyme words yet.</p>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', maxWidth: '800px' }}>
          <p
            style={{
              fontSize: 'clamp(1.6rem, 5vw, 3rem)',
              fontWeight: 700,
              color: 'var(--color-text)',
              lineHeight: 1.3,
              margin: 0,
            }}
          >
            {card?.text}
          </p>
          {mode === 'openers' && (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem', marginTop: '1rem' }}>
              tap anywhere for next card
            </p>
          )}
        </div>
      )}

      <HistoryModal isOpen={showHistory} onClose={() => setShowHistory(false)} />
    </div>
  )
}
