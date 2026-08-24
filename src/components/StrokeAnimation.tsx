import { useEffect, useRef } from 'react'
import HanziWriter from 'hanzi-writer'

interface StrokeAnimationProps {
  character: string
  size?: number
}

export function StrokeAnimation({ character, size = 180 }: StrokeAnimationProps) {

  // ref points at the real DOM node
  const containerRef = useRef<HTMLDivElement>(null)

  // keep the writer instance for the Replay button
  const writerRef = useRef<HanziWriter | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const writer = HanziWriter.create(container, character, {
      width: size,
      height: size,
      padding: 8,
      showOutline: true,
      delayBetweenStrokes: 400,
      strokeColor: '#111827',
      outlineColor: '#d1d5db',
    })

    writerRef.current = writer
    writer.animateCharacter()

    // cleanup: wipe the old SVG when unmounting or when character changes
    return () => {
      writerRef.current = null
      container.innerHTML = ''
    }
  }, [character, size])

  return (
    <div className="animation-box">
      <h3 className="animation-title">Stroke order</h3>
      <div ref={containerRef} className="stroke-target" />
      <div className="button-row">
        <button
          className="secondary-btn small"
          onClick={() => writerRef.current?.animateCharacter()}
        >
          Replay
        </button>
      </div>
    </div>
  )
}