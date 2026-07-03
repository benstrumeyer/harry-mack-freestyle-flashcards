interface Props {
  density: number
  artistDensity?: number | null
}

const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

/**
 * Displays the Raplyzer rhyme-density score for a song, optionally alongside the
 * artist-wide average for context.
 */
export default function DensityPanel({ density, artistDensity }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '1.5rem',
        alignItems: 'baseline',
        padding: '0.6rem 0.9rem',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        background: 'var(--color-surface)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
          Rhyme density
        </span>
        <span data-density style={{ fontFamily: MONO, fontSize: '1.35rem', fontWeight: 700, color: 'var(--color-primary)' }}>
          {density.toFixed(2)}
        </span>
      </div>
      {artistDensity != null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
            Artist avg
          </span>
          <span style={{ fontFamily: MONO, fontSize: '1.35rem', fontWeight: 700, color: 'var(--color-muted)' }}>
            {artistDensity.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}
