interface Props {
  scheme?: string | null
}

/** A small pill showing a bar's rhyme scheme letters (e.g. "AABB", "ABAB"). */
export default function SchemeBadge({ scheme }: Props) {
  if (!scheme) return null
  return (
    <span
      data-scheme={scheme}
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
        fontSize: '0.62rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        color: 'var(--color-muted)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '999px',
        padding: '0.05rem 0.45rem',
        whiteSpace: 'nowrap',
      }}
    >
      {scheme}
    </span>
  )
}
