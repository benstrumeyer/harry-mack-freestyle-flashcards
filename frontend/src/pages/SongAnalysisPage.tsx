import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type VideoAnalysisDto, type UserAnnotationDto } from '../services/api'
import AnnotatedTranscript from '../components/AnnotatedTranscript'
import UserTranscript from '../components/UserTranscript'
import BarEditor, { type BarEditorHandle } from '../components/BarEditor'
import DensityPanel from '../components/DensityPanel'
import DetectorLegend from '../components/DetectorLegend'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

export default function SongAnalysisPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const [analysis, setAnalysis] = useState<VideoAnalysisDto | null>(null)
  const [annotation, setAnnotation] = useState<UserAnnotationDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showMachine, setShowMachine] = useState(false)
  const editorRef = useRef<BarEditorHandle>(null)

  useEffect(() => {
    if (!videoId) return
    setLoading(true)
    setError(false)
    api.getVideoAnalysis(videoId)
      .then(setAnalysis)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [videoId])

  // Load the user's saved annotation once. Leaving edit mode does NOT refetch —
  // handleDone sets it from the editor's own save so there's no save-vs-read race.
  useEffect(() => {
    if (!videoId) return
    api.getAnnotation(videoId).then(setAnnotation).catch(() => setAnnotation(null))
  }, [videoId])

  // "Done editing": deterministically save first, adopt the saved DTO, then exit.
  const handleToggleEdit = async () => {
    if (!editing) { setEditing(true); return }
    try {
      const saved = await editorRef.current?.flush()
      if (saved) setAnnotation(saved)
    } catch { /* keep editing state on failure? no — data is also autosaved */ }
    setEditing(false)
  }

  const hasUser = !!(annotation && annotation.bars.length > 0)

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
        <Link to="/songs" style={{ fontSize: '0.75rem', color: 'var(--color-muted)', textDecoration: 'none', flexShrink: 0 }}>
          ← Songs
        </Link>
        <h1 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
          {analysis?.video.title ?? videoId ?? 'Song'}
        </h1>
        {analysis?.video.artist && (
          <span style={{ fontFamily: MONO, fontSize: '0.72rem', color: 'var(--color-primary)' }}>
            {analysis.video.artist}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!editing && hasUser && (
          <button
            onClick={() => setShowMachine((v) => !v)}
            style={{
              fontFamily: MONO, fontSize: '0.72rem', padding: '4px 12px', borderRadius: 5, cursor: 'pointer',
              border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-muted)',
            }}
          >
            {showMachine ? '↩ Your version' : '👁 Machine original'}
          </button>
        )}
        <button
          onClick={handleToggleEdit}
          style={{
            fontFamily: MONO, fontSize: '0.72rem', padding: '4px 12px', borderRadius: 5, cursor: 'pointer',
            border: `1px solid ${editing ? 'var(--color-primary)' : 'var(--color-border)'}`,
            background: editing ? 'var(--color-primary)' : 'transparent',
            color: editing ? '#0a0a0a' : 'var(--color-muted)',
          }}
        >
          {editing ? '✓ Done editing' : '✎ Edit bars'}
        </button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          loading…
        </div>
      ) : error || !analysis ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted)', fontSize: '0.9rem' }}>
          No analysis available for this video yet.
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {analysis.video.youtubeId && (
            <div style={{ width: '100%', maxWidth: 640, alignSelf: 'center' }}>
              <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                <iframe
                  title={analysis.video.title ?? 'video'}
                  src={`https://www.youtube-nocookie.com/embed/${analysis.video.youtubeId}`}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}
          {editing ? (
            <BarEditor ref={editorRef} analysis={analysis} videoId={videoId!} />
          ) : hasUser && !showMachine ? (
            // Your fully-edited version (chatter removed, your rhyme scheme).
            <UserTranscript analysis={analysis} annotation={annotation!} />
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <DensityPanel density={analysis.density} />
                <DetectorLegend />
              </div>
              <AnnotatedTranscript analysis={analysis} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
