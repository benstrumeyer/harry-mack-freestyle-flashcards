export interface DetectorInfo {
  detector: string
  label: string
  description: string
  hue: number
}

/** The fixed, bounded detector taxonomy (matches extractor detectors.py). */
export const DETECTORS: DetectorInfo[] = [
  { detector: 'perfect-end', label: 'Perfect end', description: 'Bar-final words with an identical canonical rhyme tail', hue: 210 },
  { detector: 'slant-end', label: 'Slant end', description: 'Bar-final words that rhyme only in delivery', hue: 265 },
  { detector: 'internal', label: 'Internal', description: 'Two rhyming words inside the same bar', hue: 45 },
  { detector: 'multisyllabic', label: 'Multisyllabic', description: 'A shared run of two or more vowels', hue: 150 },
  { detector: 'chain', label: 'Chain', description: 'A rhyme carried across three or more consecutive bars', hue: 0 },
  { detector: 'none', label: 'None', description: 'No detected rhyme relationship', hue: 0 },
]

/**
 * Legend for the annotated transcript. The important message first: word COLORS
 * mark rhyme groups (words sharing a color rhyme with each other) — colors are
 * not per-detector. The six detector *types* are listed as a reference for the
 * per-word hover tooltip.
 */
export default function DetectorLegend() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem', maxWidth: '46rem' }}>
      <div style={{ color: 'var(--color-muted)' }}>
        <strong style={{ color: 'var(--color-text)' }}>Colors = rhyme groups</strong>
        {' '}— words sharing a color rhyme with each other. Hover a word for its rhyme sound &amp; type.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', color: 'var(--color-muted)' }}>
        <span>Types:</span>
        {DETECTORS.filter((d) => d.detector !== 'none').map((d) => (
          <span key={d.detector} data-swatch={d.detector} title={d.description}
                style={{ borderBottom: '2px solid hsl(' + d.hue + ' 70% 55%)', paddingBottom: '1px' }}>
            {d.label}
          </span>
        ))}
        <span data-swatch="none" title="No detected rhyme relationship">None</span>
      </div>
    </div>
  )
}
