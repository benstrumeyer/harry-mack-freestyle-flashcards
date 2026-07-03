interface Props {
  text: string
  hue: number | null
  groupKey?: string | null
  detector?: string | null
}

/**
 * A single transcript word. When it belongs to a rhyme group (hue present) it is
 * tinted with that group's color — words sharing a color rhyme with each other.
 * Hovering reveals the shared rhyme sound and the detected rhyme type.
 */
export default function RhymeToken({ text, hue, groupKey, detector }: Props) {
  const colored = hue != null
  const tip = colored
    ? `rhymes: ${groupKey || '—'}${detector && detector !== 'none' ? ` · ${detector}` : ''}`
    : undefined
  return (
    <span
      title={tip}
      style={
        colored
          ? {
              background: `hsl(${hue} 75% 50% / 0.45)`,
              borderRadius: '3px',
              padding: '0 2px',
              cursor: 'help',
            }
          : undefined
      }
    >
      {text}
    </span>
  )
}
