import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../services/api'
import type { OpenerChallengeDto, OpenerValidationDto } from '../services/api'

// Rhyme Game — Opener mode (spec §7b / Spec 2, Task 5.2).
// Presents an opener; the player inputs rhymes; each guess is validated against the
// Task 5.1 backend (`GET /api/game/opener/{id}` for the target rhyme sound + valid words,
// `POST /api/game/opener/{id}/validate` for scoring). Rendered as a mode on the /game page.

const ORANGE = '#F08A2E'
const GREEN = '#8FE0B4'
const RED = '#F0846E'

type Accepted = { word: string; matchedOn: string | null }

const card = {
  background: '#1E1740',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 14,
  padding: '16px 18px',
} as const
const label = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.4,
  color: 'rgba(244,238,225,0.5)',
  marginBottom: 10,
} as const

// A short human label for how the guess matched the target rhyme sound.
function matchLabel(matchedOn: string | null): string {
  switch (matchedOn) {
    case 'canonical':
      return 'perfect'
    case 'delivered':
      return 'slant'
    case 'dictionary':
      return 'in the bank'
    default:
      return 'match'
  }
}

export default function OpenerMode() {
  const [openerIds, setOpenerIds] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const [challenge, setChallenge] = useState<OpenerChallengeDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [accepted, setAccepted] = useState<Accepted[]>([])
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Load the opener list once — the challenge/validation come from the Task 5.1 endpoints.
  useEffect(() => {
    let live = true
    api
      .getOpeners()
      .then((ops) => {
        if (!live) return
        setOpenerIds(ops.map((o) => o.id))
        if (ops.length === 0) setLoading(false)
      })
      .catch(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [])

  // (Re)load the current opener's challenge whenever it changes.
  useEffect(() => {
    if (openerIds.length === 0) return
    const id = openerIds[idx]
    if (!id) return
    let live = true
    setLoading(true)
    setChallenge(null)
    setAccepted([])
    setFeedback(null)
    setInput('')
    api
      .getOpenerChallenge(id)
      .then((c) => {
        if (!live) return
        setChallenge(c)
        setLoading(false)
      })
      .catch(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [openerIds, idx])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const word = input.trim().toLowerCase()
    if (!word || !challenge || submitting) return
    if (accepted.some((a) => a.word === word)) {
      setFeedback({ ok: false, msg: `“${word}” already counted` })
      setInput('')
      return
    }
    setSubmitting(true)
    try {
      const res: OpenerValidationDto = await api.validateOpenerGuess(challenge.openerId, word)
      if (res.valid) {
        setAccepted((a) => [{ word: res.word, matchedOn: res.matchedOn }, ...a])
        setFeedback({ ok: true, msg: `“${res.word}” rhymes — ${matchLabel(res.matchedOn)}` })
      } else {
        setFeedback({ ok: false, msg: `“${word}” doesn’t rhyme with the target` })
      }
    } catch {
      setFeedback({ ok: false, msg: 'Could not validate — is the backend running?' })
    } finally {
      setSubmitting(false)
      setInput('')
    }
  }

  const nextOpener = () => {
    if (openerIds.length === 0) return
    setIdx((i) => (i + 1) % openerIds.length)
  }

  if (loading && !challenge) {
    return (
      <div style={{ padding: '8px 20px 32px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <div style={{ ...card, color: 'rgba(244,238,225,0.55)', textAlign: 'center' }}>Loading openers…</div>
      </div>
    )
  }

  if (openerIds.length === 0) {
    return (
      <div style={{ padding: '8px 20px 32px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <div style={{ ...card, color: 'rgba(244,238,225,0.55)', textAlign: 'center' }}>
          No openers available yet — process a video on the Pipeline page first.
        </div>
      </div>
    )
  }

  const hasTarget = !!(challenge && challenge.targetWord)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 20px 32px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
      {/* Opener + target rhyme sound */}
      <div style={card}>
        <div style={label}>OPENER</div>
        <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25 }}>{challenge?.openerText}</div>
        {hasTarget ? (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'rgba(244,238,225,0.5)' }}>Rhyme with</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, background: 'rgba(240,138,46,0.16)', border: '1.5px solid ' + ORANGE, fontWeight: 800, fontSize: 18 }}>
              {challenge!.targetWord}
            </span>
            {challenge!.targetKey && (
              <span style={{ fontSize: 11, letterSpacing: 0.6, color: 'rgba(244,238,225,0.45)' }}>
                /{challenge!.targetKey}/{challenge!.targetDeliveredKey ? ` · delivered /${challenge!.targetDeliveredKey}/` : ''}
              </span>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 13, color: 'rgba(244,238,225,0.5)' }}>
            This opener has no analyzed source-bar rhyme yet — skip to the next one.
          </div>
        )}
      </div>

      {/* Guess input */}
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a word that rhymes…"
          disabled={!hasTarget}
          autoFocus
          style={{ flex: 1, padding: '15px 18px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.15)', background: '#1E1740', color: '#F4EEE1', fontSize: 16, fontFamily: "'Archivo', system-ui, sans-serif", outline: 'none' }}
        />
        <button
          type="submit"
          disabled={!hasTarget || submitting}
          style={{ padding: '0 22px', borderRadius: 14, border: 'none', background: ORANGE, color: '#1A0F00', fontWeight: 900, fontSize: 15, letterSpacing: 1, cursor: hasTarget ? 'pointer' : 'not-allowed', opacity: hasTarget ? 1 : 0.5 }}
        >
          {submitting ? '…' : 'Submit'}
        </button>
      </form>

      {/* Feedback line */}
      {feedback && (
        <div style={{ fontSize: 14, fontWeight: 700, color: feedback.ok ? GREEN : RED }}>{feedback.msg}</div>
      )}

      {/* Score + accepted rhymes */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{`Score: ${accepted.length}`}</div>
          <button
            onClick={nextOpener}
            type="button"
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#F4EEE1', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            Next opener ›
          </button>
        </div>
        {accepted.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {accepted.map((a) => (
              <span key={a.word} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, background: 'rgba(143,224,180,0.14)', border: '1px solid rgba(143,224,180,0.4)', fontWeight: 700, fontSize: 14 }}>
                {a.word}
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: 'rgba(244,238,225,0.6)' }}>{matchLabel(a.matchedOn)}</span>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 13, color: 'rgba(244,238,225,0.45)' }}>
            Land as many rhymes as you can, then move to the next opener.
          </div>
        )}
      </div>
    </div>
  )
}
