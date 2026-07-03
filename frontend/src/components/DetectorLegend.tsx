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

/** Static legend of the six fixed rhyme-pattern detectors and their swatches. */
export default function DetectorLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.85rem' }}>
      {DETECTORS.map((d) => (
        <div key={d.detector} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }} title={d.description}>
          <span
            data-swatch={d.detector}
            style={{
              display: 'inline-block',
              width: '14px',
              height: '14px',
              borderRadius: '3px',
              background: d.detector === 'none' ? 'transparent' : `hsl(${d.hue} 70% 45% / 0.55)`,
              border: d.detector === 'none' ? '1px solid currentColor' : 'none',
            }}
          />
          <span>{d.label}</span>
        </div>
      ))}
    </div>
  )
}
