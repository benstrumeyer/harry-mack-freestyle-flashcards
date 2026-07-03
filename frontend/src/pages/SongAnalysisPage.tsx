import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type VideoAnalysisDto } from '../services/api'
import AnnotatedTranscript from '../components/AnnotatedTranscript'
import DensityPanel from '../components/DensityPanel'
import DetectorLegend from '../components/DetectorLegend'

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

export default function SongAnalysisPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const [analysis, setAnalysis] = useState<VideoAnalysisDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!videoId) return
    setLoading(true)
    setError(false)
    api.getVideoAnalysis(videoId)
      .then(setAnalysis)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [videoId])

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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
            <DensityPanel density={analysis.density} />
            <DetectorLegend />
          </div>
          <AnnotatedTranscript analysis={analysis} />
        </div>
      )}
    </div>
  )
}
