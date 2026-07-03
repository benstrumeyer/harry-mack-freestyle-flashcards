interface Props {
  text: string
  hue: number | null
  groupKey?: string | null
  detector?: string | null
  /** The bar's ending rhyme — the anchor. Rendered bolder + stronger fill. */
  isEnd?: boolean
  /** A rhyme that lands inside the bar (not the ending) — underlined. */
  isInternal?: boolean
}

/**
 * A single transcript word. When it belongs to a rhyme group (hue present) it is
 * tinted with that group's color — words sharing a color rhyme with each other.
 * The bar's END rhyme is bold; INTERNAL rhymes are underlined (convention from
 * RHYMEBOOK / RapAnalysis-style breakdowns). Hover shows the shared rhyme sound.
 */
export default function RhymeToken({ text, hue, groupKey, detector, isEnd, isInternal }: Props) {
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
              background: `hsl(${hue} 75% 50% / ${isEnd ? 0.6 : 0.32})`,
              borderRadius: '3px',
              padding: '0 3px',
              fontWeight: isEnd ? 700 : 400,
              textDecoration: isInternal && !isEnd ? 'underline' : undefined,
              textDecorationStyle: 'dotted',
              textUnderlineOffset: '2px',
              cursor: 'help',
            }
          : undefined
      }
    >
      {text}
    </span>
  )
}
