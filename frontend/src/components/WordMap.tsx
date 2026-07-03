import { useEffect, useRef, useState } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import type { RhymeWordDto, RhymePairDto } from '../services/api'

interface Props {
  nodes: RhymeWordDto[]
  edges: RhymePairDto[]
}

interface NodePos extends SimulationNodeDatum {
  id: string
  word: string
  frequency: number
  x?: number
  y?: number
}

interface LinkPos extends SimulationLinkDatum<NodePos> {
  frequency: number
}

const WIDTH = 800
const HEIGHT = 500

export default function WordMap({ nodes, edges }: Props) {
  const [positions, setPositions] = useState<NodePos[]>([])
  const [linkPositions, setLinkPositions] = useState<{ x1: number; y1: number; x2: number; y2: number; key: string }[]>([])
  const simRef = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    if (nodes.length === 0) return

    const nodeData: NodePos[] = nodes.map(n => ({
      id: n.id,
      word: n.word,
      frequency: n.frequency,
    }))

    const nodeById = new Map(nodeData.map(n => [n.word, n]))

    const linkData: LinkPos[] = edges
      .map(e => {
        const source = nodeById.get(e.wordA)
        const target = nodeById.get(e.wordB)
        if (!source || !target) return null
        return { source, target, frequency: e.frequency } as LinkPos
      })
      .filter((l): l is LinkPos => l !== null)

    if (simRef.current) simRef.current.stop()

    const sim = forceSimulation(nodeData)
      .force(
        'link',
        forceLink<NodePos, LinkPos>(linkData)
          .id(d => d.id)
          .distance(90)
      )
      .force('charge', forceManyBody().strength(-180))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collide', forceCollide(22))

    sim.on('tick', () => {
      setPositions([...nodeData])
      setLinkPositions(
        linkData.map((l, i) => {
          const s = l.source as NodePos
          const t = l.target as NodePos
          return {
            key: `${i}`,
            x1: s.x ?? 0,
            y1: s.y ?? 0,
            x2: t.x ?? 0,
            y2: t.y ?? 0,
          }
        })
      )
    })

    simRef.current = sim

    return () => {
      sim.stop()
    }
  }, [nodes, edges])

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#0a0a18',
      }}
    >
      <svg width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: 'block' }}>
        <g>
          {linkPositions.map(l => (
            <line
              key={l.key}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="#533483"
              strokeOpacity={0.5}
              strokeWidth={1}
            />
          ))}
        </g>
        <g>
          {positions.map(n => {
            const r = Math.min(5 + n.frequency * 2, 18)
            return (
              <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`}>
                <circle r={r} fill="#e94560" fillOpacity={0.75} />
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize={r > 12 ? 11 : 9}
                  fill="#fff"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {n.word}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
