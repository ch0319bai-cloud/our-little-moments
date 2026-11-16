import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useGesture } from '@use-gesture/react'
import './DomeGallery.css'

export type DomeImage = string | { src: string; alt?: string }
type FitBasis = 'auto' | 'min' | 'max' | 'width' | 'height'

interface DomeGalleryProps {
  images: DomeImage[]
  fit?: number
  fitBasis?: FitBasis
  minRadius?: number
  maxRadius?: number
  padFactor?: number
  overlayBlurColor?: string
  maxVerticalRotationDeg?: number
  dragSensitivity?: number
  enlargeTransitionMs?: number
  segments?: number
  openedImageWidth?: string
  openedImageHeight?: string
  imageBorderRadius?: string
  openedImageBorderRadius?: string
  grayscale?: boolean
}

interface Tile {
  x: number
  y: number
  sizeX: number
  sizeY: number
  src: string
  alt: string
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const wrapAngle = (value: number) => {
  const angle = (((value + 180) % 360) + 360) % 360
  return angle - 180
}

function buildItems(images: DomeImage[], segments: number): Tile[] {
  const columns = Array.from({ length: segments }, (_, index) => -37 + index * (74 / Math.max(1, segments - 1)))
  const coordinates = columns.flatMap((x, column) => {
    const rows = column % 2 === 0 ? [-4, -2, 0, 2, 4] : [-3, -1, 1, 3, 5]
    return rows.map((y) => ({ x, y, sizeX: 2, sizeY: 2 }))
  })
  if (!images.length) return []
  const normalized = images.map((image) => typeof image === 'string'
    ? { src: image, alt: '' }
    : { src: image.src, alt: image.alt ?? '' })
  const pool = Array.from({ length: coordinates.length }, (_, index) => normalized[index % normalized.length])
  for (let index = 1; index < pool.length; index += 1) {
    if (pool[index].src === pool[index - 1].src && pool.length > 1) {
      const other = pool.findIndex((image, candidate) => candidate > index && image.src !== pool[index].src)
      if (other >= 0) [pool[index], pool[other]] = [pool[other], pool[index]]
    }
  }
  return coordinates.map((coordinate, index) => ({ ...coordinate, ...pool[index] }))
}

export default function DomeGallery({
  images,
  fit = 0.5,
  fitBasis = 'auto',
  minRadius = 600,
  maxRadius = Number.POSITIVE_INFINITY,
  padFactor = 0.25,
  overlayBlurColor = '#f4e6c8',
  maxVerticalRotationDeg = 5,
  dragSensitivity = 20,
  enlargeTransitionMs = 300,
  segments = 35,
  openedImageWidth = 'min(72vw, 420px)',
  openedImageHeight = 'min(72vh, 520px)',
  imageBorderRadius = '14px',
  openedImageBorderRadius = '24px',
  grayscale = false,
}: DomeGalleryProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const sphereRef = useRef<HTMLDivElement>(null)
  const rotationRef = useRef({ x: 0, y: 0 })
  const dragStartRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const didDragRef = useRef(false)
  const suppressClickRef = useRef(false)
  const [radius, setRadius] = useState(minRadius)
  const [opened, setOpened] = useState<DomeImage | null>(null)
  const items = useMemo(() => buildItems(images, segments), [images, segments])

  const applyTransform = useCallback((x: number, y: number) => {
    if (sphereRef.current) {
      sphereRef.current.style.transform = 'translateZ(calc(var(--radius) * -1)) rotateX(' + x + 'deg) rotateY(' + y + 'deg)'
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, entry.contentRect.width)
      const height = Math.max(1, entry.contentRect.height)
      const minDimension = Math.min(width, height)
      const maxDimension = Math.max(width, height)
      const basis = fitBasis === 'width' ? width
        : fitBasis === 'height' ? height
          : fitBasis === 'min' ? minDimension
            : fitBasis === 'max' ? maxDimension
              : width / height >= 1.3 ? width : minDimension
      const nextRadius = clamp(Math.min(basis * fit, height * 1.35), minRadius, maxRadius)
      setRadius(Math.round(nextRadius))
      root.style.setProperty('--radius', Math.round(nextRadius) + 'px')
      root.style.setProperty('--item-width', (nextRadius * Math.PI / segments) + 'px')
      root.style.setProperty('--item-height', (nextRadius * Math.PI / segments) + 'px')
      root.style.setProperty('--viewer-pad', Math.max(8, Math.round(minDimension * padFactor)) + 'px')
      root.style.setProperty('--overlay-blur-color', overlayBlurColor)
      root.style.setProperty('--tile-radius', imageBorderRadius)
      root.style.setProperty('--enlarge-radius', openedImageBorderRadius)
      root.style.setProperty('--image-filter', grayscale ? 'grayscale(1)' : 'none')
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [fit, fitBasis, minRadius, maxRadius, padFactor, overlayBlurColor, imageBorderRadius, openedImageBorderRadius, grayscale, segments])

  useEffect(() => {
    rootRef.current?.style.setProperty('--radius', radius + 'px')
    applyTransform(rotationRef.current.x, rotationRef.current.y)
  }, [radius, applyTransform])

  useEffect(() => {
    let frame = 0
    let previousTime = performance.now()

    const rotate = (time: number) => {
      const elapsed = Math.min(time - previousTime, 50)
      previousTime = time

      if (!isDraggingRef.current && !opened) {
        const nextY = wrapAngle(rotationRef.current.y + elapsed * 0.006)
        rotationRef.current = { ...rotationRef.current, y: nextY }
        applyTransform(rotationRef.current.x, nextY)
      }

      frame = window.requestAnimationFrame(rotate)
    }

    frame = window.requestAnimationFrame(rotate)
    return () => window.cancelAnimationFrame(frame)
  }, [opened, applyTransform])

  useEffect(() => {
    if (!opened) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpened(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [opened])

  useGesture(
    {
      onDragStart: () => {
        isDraggingRef.current = true
        dragStartRef.current = { ...rotationRef.current }
        didDragRef.current = false
        suppressClickRef.current = false
      },
      onDrag: ({ movement: [moveX, moveY], last }) => {
        if (Math.abs(moveX) + Math.abs(moveY) > 4) didDragRef.current = true
        const nextX = clamp(dragStartRef.current.x - moveY / dragSensitivity, -maxVerticalRotationDeg, maxVerticalRotationDeg)
        const nextY = wrapAngle(dragStartRef.current.y + moveX / dragSensitivity)
        rotationRef.current = { x: nextX, y: nextY }
        applyTransform(nextX, nextY)
        if (last) isDraggingRef.current = false
        if (last && didDragRef.current) {
          suppressClickRef.current = true
          window.setTimeout(() => { suppressClickRef.current = false; didDragRef.current = false }, 100)
        }
      },
      onDragEnd: () => {
        isDraggingRef.current = false
      },
    },
    { target: mainRef, eventOptions: { passive: true }, drag: { filterTaps: true } },
  )

  const openImage = (image: DomeImage) => {
    if (suppressClickRef.current || didDragRef.current) return
    setOpened(image)
  }
  const openedSource = typeof opened === 'string' ? opened : opened?.src
  const openedAlt = typeof opened === 'string' ? '' : opened?.alt ?? ''

  return (
    <div ref={rootRef} className="dome-gallery" style={{ '--segments-x': segments, '--segments-y': segments } as CSSProperties}>
      <main ref={mainRef} className="dome-gallery-main">
        <div className="dome-gallery-stage">
          <div ref={sphereRef} className="dome-gallery-sphere">
            {items.map((item, index) => {
              const unit = 360 / segments / 2
              const rotateY = unit * (item.x + (item.sizeX - 1) / 2)
              const rotateX = unit * (item.y - (item.sizeY - 1) / 2)
              return (
                <div
                  className="dome-gallery-tile"
                  key={item.src + '-' + index}
                  style={{
                    '--offset-x': item.x,
                    '--offset-y': item.y,
                    '--item-size-x': item.sizeX,
                    '--item-size-y': item.sizeY,
                    '--base-rotate-x': rotateX + 'deg',
                    '--base-rotate-y': rotateY + 'deg',
                    '--enlarge-transition': enlargeTransitionMs + 'ms',
                  } as CSSProperties}
                >
                  <button
                    className="dome-gallery-image"
                    type="button"
                    onClick={() => openImage(item)}
                    aria-label={item.alt ? '查看：' + item.alt : '放大查看照片'}
                  >
                    <img src={item.src} alt={item.alt ?? ''} draggable={false} loading="lazy" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <div className="dome-gallery-overlay" />
        <div className="dome-gallery-overlay dome-gallery-overlay-blur" />
        <div className="dome-gallery-edge dome-gallery-edge-top" />
        <div className="dome-gallery-edge dome-gallery-edge-bottom" />
      </main>
      {openedSource && (
        <div className="dome-lightbox" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpened(null)
        }}>
          <div className="dome-lightbox-panel" role="dialog" aria-modal="true" aria-label={openedAlt || '回忆照片'}>
            <button className="dome-lightbox-close" onClick={() => setOpened(null)} aria-label="关闭照片">×</button>
            <img
              src={openedSource}
              alt={openedAlt}
              style={{ width: openedImageWidth, height: openedImageHeight, borderRadius: openedImageBorderRadius }}
            />
            {openedAlt && <p>{openedAlt}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
