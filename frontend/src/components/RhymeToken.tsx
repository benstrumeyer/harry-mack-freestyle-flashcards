interface Props {
  text: string
  hue: number | null
  detector?: string | null
}

/**
 * A single transcript word. When it belongs to a rhyme group (hue present) it is
 * tinted with that group's HSL color; the detector label is exposed as the tooltip.
 */
export default function RhymeToken({ text, hue, detector }: Props) {
  const colored = hue != null
  return (
    <span
      title={detector ?? undefined}
      style={
        colored
          ? {
              background: `hsl(${hue} 70% 45% / 0.35)`,
              borderRadius: '3px',
              padding: '0 2px',
            }
          : undefined
      }
    >
      {text}
    </span>
  )
}
