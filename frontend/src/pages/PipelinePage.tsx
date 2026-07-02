import { useState, useEffect, useRef } from 'react'
import { api, type PipelineResultDto, type PlaylistQueuedDto, type VideoStatusDto } from '../services/api'

function ResultBadge({ result }: { result: PipelineResultDto }) {
  return (
    <div
      style={{
        marginTop: '0.75rem',
        padding: '0.75rem 1rem',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        fontSize: '0.88rem',
        lineHeight: 1.6,
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>{result.message}</p>
      <p style={{ margin: '0.3rem 0 0', color: 'var(--color-muted)' }}>
        {result.barsExtracted} bars · {result.openersFound} openers · {result.rhymeWordsFound} rhyme words
      </p>
    </div>
  )
}

export default function PipelinePage() {
  const [validateLoading, setValidateLoading] = useState(false)
  const [validateResult, setValidateResult] = useState<{ message: string; removed: number; total: number } | null>(null)
  const [validateError, setValidateError] = useState<string | null>(null)

  const [ytUrl, setYtUrl] = useState('')
  const [artist, setArtist] = useState('harry_mack')
  const [ytLoading, setYtLoading] = useState(false)
  const [ytResult, setYtResult] = useState<PipelineResultDto | null>(null)
  const [ytError, setYtError] = useState<string | null>(null)
  const [ytElapsed, setYtElapsed] = useState(0)

  const [plQueued, setPlQueued] = useState<PlaylistQueuedDto | null>(null)  // set when running in background

  const [status, setStatus] = useState<VideoStatusDto[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ytTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshStatus = () => {
    api.getPipelineStatus()
      .then(setStatus)
      .catch(() => {})
  }

  useEffect(() => { refreshStatus() }, [])

  // Poll while single video is processing
  useEffect(() => {
    if (ytLoading) {
      setYtElapsed(0)
      ytTimerRef.current = setInterval(() => setYtElapsed(s => s + 1), 1000)
      if (!pollRef.current) pollRef.current = setInterval(refreshStatus, 4000)
    } else {
      if (ytTimerRef.current) { clearInterval(ytTimerRef.current); ytTimerRef.current = null }
      if (!plQueued && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    return () => { if (ytTimerRef.current) clearInterval(ytTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytLoading])

  // Poll while playlist is running in background
  useEffect(() => {
    if (plQueued) {
      if (!pollRef.current) pollRef.current = setInterval(refreshStatus, 4000)
    } else {
      if (!ytLoading && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plQueued])

  const isPlaylistUrl = (url: string) =>
    /list=|\/playlist|\/show\/|watch_videos/i.test(url)

  const fmtElapsed = (s: number) =>
    s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`

  const validateRhymes = async () => {
    setValidateLoading(true)
    setValidateResult(null)
    setValidateError(null)
    try {
      const r = await api.validateRhymes()
      setValidateResult(r)
      refreshStatus()
    } catch (e) {
      setValidateError(String(e))
    } finally {
      setValidateLoading(false)
    }
  }

  const processYouTube = async () => {
    const url = ytUrl.trim()
    if (!url) return
    setYtResult(null)
    setYtError(null)
    if (isPlaylistUrl(url)) {
      setYtLoading(true)
      try {
        const r = await api.processPlaylist(url)
        if (r.videoCount > 0) {
          setPlQueued(r)
          setYtUrl('')
        }
      } catch (e) {
        setYtError(String(e))
      } finally {
        setYtLoading(false)
      }
    } else {
      setYtLoading(true)
      try {
        const r = await api.processUrl(url, artist)
        setYtResult(r)
        setYtUrl('')
        refreshStatus()
      } catch (e) {
        setYtError(String(e))
      } finally {
        setYtLoading(false)
      }
    }
  }

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '0.6rem 1.1rem',
    background: disabled ? 'var(--color-border)' : 'var(--color-primary)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.9rem',
    whiteSpace: 'nowrap',
  })

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '0.6rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: '0.9rem',
    outline: 'none',
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '1.5rem' }}>
        Pipeline
      </h1>

      {/* Validate Rhymes section */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          Validate Rhymes
        </h2>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
          Uses eSpeak phonetics to remove rhyme pairs that don't actually share the same vowel+consonant ending.
        </p>
        <button
          onClick={validateRhymes}
          disabled={validateLoading}
          style={{
            padding: '0.6rem 1.2rem',
            background: validateLoading ? 'var(--color-border)' : 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 600,
            cursor: validateLoading ? 'not-allowed' : 'pointer',
            fontSize: '0.9rem',
          }}
        >
          {validateLoading ? 'Validating…' : 'Validate Rhymes'}
        </button>
        {validateResult && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '0.88rem' }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{validateResult.message}</p>
            <p style={{ margin: '0.3rem 0 0', color: 'var(--color-muted)' }}>
              {validateResult.total - validateResult.removed} valid pairs remaining
            </p>
          </div>
        )}
        {validateError && (
          <p style={{ color: 'var(--color-primary)', marginTop: '0.5rem', fontSize: '0.85rem' }}>
            Error: {validateError}
          </p>
        )}
      </section>

      {/* YouTube URL section — handles both videos and playlists */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          YouTube URL
        </h2>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
          Paste a YouTube video or playlist URL. Playlists will be processed video by video — already-done videos are skipped automatically.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select
            value={artist}
            onChange={e => setArtist(e.target.value)}
            disabled={!!plQueued}
            aria-label="Artist"
            style={{
              padding: '0.6rem 0.7rem',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              fontSize: '0.9rem',
              outline: 'none',
              opacity: plQueued ? 0.5 : 1,
            }}
          >
            <option value="harry_mack">Harry Mack</option>
            <option value="juice_wrld">Juice WRLD</option>
          </select>
          <input
            type="text"
            placeholder="https://www.youtube.com/watch?v=... or playlist?list=..."
            value={ytUrl}
            onChange={e => setYtUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && processYouTube()}
            disabled={!!plQueued}
            style={{ ...inputStyle, opacity: plQueued ? 0.5 : 1 }}
          />
          <button
            onClick={processYouTube}
            disabled={ytLoading || !ytUrl.trim() || !!plQueued}
            style={btnStyle(ytLoading || !ytUrl.trim() || !!plQueued)}
          >
            {ytLoading
              ? (isPlaylistUrl(ytUrl) ? 'Fetching list…' : `Processing… ${fmtElapsed(ytElapsed)}`)
              : 'Process'}
          </button>
        </div>
        {ytResult && <ResultBadge result={ytResult} />}
        {ytError && (
          <p style={{ color: 'var(--color-primary)', marginTop: '0.5rem', fontSize: '0.85rem' }}>
            Error: {ytError}
          </p>
        )}

        {/* Background processing banner */}
        {plQueued && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem 1rem',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              fontSize: '0.88rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>
                Processing {plQueued.videoCount} videos in the background
              </span>
              <span style={{ color: 'var(--color-muted)', display: 'block', fontSize: '0.82rem', marginTop: '0.15rem' }}>
                5 at a time · videos appear below as they complete · safe to navigate away
              </span>
            </span>
            <button
              onClick={() => setPlQueued(null)}
              title="Dismiss"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-muted)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                flexShrink: 0,
                padding: '0.2rem 0.5rem',
              }}
            >
              Dismiss
            </button>
          </div>
        )}
      </section>

      {/* Status */}
      <section>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>
          Processed Sources
          {(ytLoading || plQueued) && (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: 400, color: 'var(--color-muted)' }}>
              · updating every 4s
            </span>
          )}
        </h2>
        {status.length === 0 ? (
          <p style={{ color: 'var(--color-muted)', fontSize: '0.88rem' }}>No sources processed yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {status.map(v => (
              <div
                key={v.id}
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    background: v.source === 'youtube' ? '#1a3a5e' : '#1a3a2e',
                    color: v.source === 'youtube' ? '#60aaff' : '#60cf9a',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    flexShrink: 0,
                  }}
                >
                  {v.source}
                </span>
                <span style={{ flex: 1, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.title ?? v.filename ?? v.url ?? 'Unknown'}
                </span>
                <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem', flexShrink: 0 }}>
                  {v.barCount} bars
                </span>
                <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem', flexShrink: 0 }}>
                  {new Date(v.processedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
