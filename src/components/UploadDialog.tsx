import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CATEGORIES, type Category, type MemoryItem } from '../types'
import { isCloudConfigured, supabase, turnstileSiteKey } from '../lib/supabase'

interface TurnstileApi {
  render: (container: HTMLElement, options: {
    sitekey: string
    theme?: 'light' | 'dark' | 'auto'
    callback: (token: string) => void
    'expired-callback'?: () => void
    'error-callback'?: () => void
  }) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
const maxBytes = 50 * 1024 * 1024
const hashCacheKey = 'our-little-moments-photo-hashes-v1'
const hashSize = 32
const hashFrequencies = 8
const similarDistance = 8
const existingPhotoLimit = 12

interface DuplicateMatch {
  uploadedName: string
  matchedName: string
  matchedId: string
  distance: number
  fromExistingAlbum: boolean
}

interface DuplicateScanResult {
  matches: DuplicateMatch[]
  checkedExisting: number
  candidateCount: number
  incomplete: boolean
}

function readHashCache(): Record<string, number[]> {
  try {
    const value = JSON.parse(window.localStorage.getItem(hashCacheKey) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(value).filter(([, hash]) =>
        Array.isArray(hash) && hash.length === 63 && hash.every((bit) => bit === 0 || bit === 1),
      ),
    ) as Record<string, number[]>
  } catch {
    return {}
  }
}

function saveHashCache(cache: Record<string, number[]>) {
  try {
    window.localStorage.setItem(hashCacheKey, JSON.stringify(cache))
  } catch {
    // Similarity checks can continue without a persistent browser cache.
  }
}

async function perceptualHash(blob: Blob): Promise<number[]> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = hashSize
  canvas.height = hashSize
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    throw new Error('Image canvas is unavailable.')
  }
  context.drawImage(bitmap, 0, 0, hashSize, hashSize)
  bitmap.close()

  const pixels = context.getImageData(0, 0, hashSize, hashSize).data
  const grayscale = new Float64Array(hashSize * hashSize)
  for (let i = 0; i < grayscale.length; i += 1) {
    const offset = i * 4
    grayscale[i] = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114
  }

  const cosine = Array.from({ length: hashFrequencies }, (_, frequency) =>
    Array.from({ length: hashSize }, (_, pixel) =>
      Math.cos(((2 * pixel + 1) * frequency * Math.PI) / (2 * hashSize)),
    ),
  )
  const coefficients: number[] = []
  for (let v = 0; v < hashFrequencies; v += 1) {
    for (let u = 0; u < hashFrequencies; u += 1) {
      let total = 0
      for (let y = 0; y < hashSize; y += 1) {
        for (let x = 0; x < hashSize; x += 1) {
          total += grayscale[y * hashSize + x] * cosine[u][x] * cosine[v][y]
        }
      }
      const scaleU = u === 0 ? Math.sqrt(1 / hashSize) : Math.sqrt(2 / hashSize)
      const scaleV = v === 0 ? Math.sqrt(1 / hashSize) : Math.sqrt(2 / hashSize)
      coefficients.push(total * scaleU * scaleV)
    }
  }

  const sorted = coefficients.slice(1).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return coefficients.slice(1).map((value) => value > median ? 1 : 0)
}

function hashDistance(left: number[], right: number[]) {
  return left.reduce((distance, bit, index) => distance + (bit === right[index] ? 0 : 1), 0)
}

async function hashRemotePhoto(url: string, signal: AbortSignal): Promise<number[]> {
  const response = await fetch(url, { mode: 'cors', cache: 'force-cache', signal })
  if (!response.ok) throw new Error('Could not read existing photo.')
  return perceptualHash(await response.blob())
}

async function scanSimilarPhotos(
  files: File[],
  existingPhotos: MemoryItem[],
  category: Category,
): Promise<DuplicateScanResult> {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  const matches: DuplicateMatch[] = []
  let incomplete = false
  const fileHashes: { file: File; hash: number[] }[] = []

  for (const file of imageFiles) {
    try {
      fileHashes.push({ file, hash: await perceptualHash(file) })
    } catch {
      incomplete = true
    }
  }

  for (let i = 0; i < fileHashes.length; i += 1) {
    for (let j = i + 1; j < fileHashes.length; j += 1) {
      const distance = hashDistance(fileHashes[i].hash, fileHashes[j].hash)
      if (distance <= similarDistance) {
        matches.push({
          uploadedName: fileHashes[j].file.name,
          matchedName: fileHashes[i].file.name,
          matchedId: `batch-${i}-${j}`,
          distance,
          fromExistingAlbum: false,
        })
      }
    }
  }

  if (imageFiles.length === 0) {
    return { matches, checkedExisting: 0, candidateCount: 0, incomplete }
  }

  const candidates = existingPhotos
    .filter((entry) => entry.category === category && entry.media_type === 'image')
    .slice(0, existingPhotoLimit)
  const hashCache = readHashCache()
  let nextCandidate = 0
  let checkedExisting = 0
  const workers = Array.from({ length: Math.min(3, candidates.length) }, async () => {
    while (nextCandidate < candidates.length) {
      const candidate = candidates[nextCandidate]
      nextCandidate += 1
      try {
        let hash = hashCache[candidate.id]
        if (!hash) {
          const controller = new AbortController()
          const timeout = window.setTimeout(() => controller.abort(), 2500)
          try {
            hash = await hashRemotePhoto(candidate.media_url, controller.signal)
          } finally {
            window.clearTimeout(timeout)
          }
          hashCache[candidate.id] = hash
          saveHashCache(hashCache)
        }
        checkedExisting += 1
        for (const uploaded of fileHashes) {
          const distance = hashDistance(uploaded.hash, hash)
          if (distance <= similarDistance) {
            matches.push({
              uploadedName: uploaded.file.name,
              matchedName: candidate.title,
              matchedId: candidate.id,
              distance,
              fromExistingAlbum: true,
            })
          }
        }
      } catch {
        incomplete = true
      }
    }
  })
  await Promise.all(workers)

  return { matches, checkedExisting, candidateCount: candidates.length, incomplete }
}

export function UploadDialog({
  initialCategory,
  existingPhotos,
  onClose,
  onSubmitted,
}: {
  initialCategory: Category
  existingPhotos: MemoryItem[]
  onClose: () => void
  onSubmitted: () => Promise<void>
}) {
  const [category, setCategory] = useState<Category>(initialCategory)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [turnstileToken, setTurnstileToken] = useState('')
  const [resetCount, setResetCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([])
  const [duplicateScanIncomplete, setDuplicateScanIncomplete] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const skipDuplicateCheck = useRef(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')
    if (!isCloudConfigured || !supabase) {
      setErrorMessage('云端相册还没有接好，完成配置后就可以投稿啦。')
      return
    }
    if (!files.length) {
      setErrorMessage('请至少选择一张照片或一段视频。')
      return
    }
    if (files.length > 10) {
      setErrorMessage('一次最多选择 10 个文件。')
      return
    }
    if (files.some((file) => !allowedTypes.includes(file.type))) {
      setErrorMessage('所有文件都需为 JPG、PNG、WebP、GIF、MP4 或 WebM 格式。')
      return
    }
    if (files.some((file) => file.size > maxBytes)) {
      setErrorMessage('单个文件请控制在 50 MB 以内。')
      return
    }
    if (!turnstileToken) {
      setErrorMessage('请先完成下面的小小安全验证。')
      return
    }

    setBusy(true)
    try {
      const skipSimilarityCheck = skipDuplicateCheck.current
      skipDuplicateCheck.current = false
      if (!skipSimilarityCheck) {
        const scan = await scanSimilarPhotos(files, existingPhotos, category)
        setDuplicateMatches(scan.matches)
        setDuplicateScanIncomplete(scan.incomplete)
        if (scan.matches.length || scan.incomplete) return
      }

      const { data: prepared, error: prepareError } = await supabase.functions.invoke('public-submit', {
        body: {
          action: 'prepareBatch',
          category,
          title: title.trim(),
          occurredAt: date || null,
          note: note.trim(),
          files: files.map((file) => ({ mimeType: file.type, fileSize: file.size })),
          turnstileToken,
        },
      })
      if (prepareError) throw new Error(prepareError.message)
      if (!Array.isArray(prepared?.uploads) || prepared.uploads.length !== files.length) {
        throw new Error(prepared?.error || '暂时无法准备上传，请稍后再试。')
      }

      for (const [index, file] of files.entries()) {
        const upload = prepared.uploads[index]
        const { error: uploadError } = await supabase.storage.from('couple-memories').uploadToSignedUrl(upload.path, upload.token, file, {
          contentType: file.type,
          upsert: false,
        })
        if (uploadError) {
          await supabase.functions.invoke('public-submit', { body: { action: 'cancel', intentId: upload.intentId } })
          throw new Error(uploadError.message)
        }
        const { data: finalized, error: finalizeError } = await supabase.functions.invoke('public-submit', {
          body: { action: 'finalize', intentId: upload.intentId },
        })
        if (finalizeError || finalized?.error) {
          await supabase.functions.invoke('public-submit', { body: { action: 'cancel', intentId: upload.intentId } })
          throw new Error(finalized?.error || finalizeError?.message || '提交没有完成，请再试一次。')
        }
      }

      setSuccess(true)
      setFiles([])
      setDuplicateMatches([])
      setDuplicateScanIncomplete(false)
      setTurnstileToken('')
      void onSubmitted()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '提交失败，请稍后再试。')
      setTurnstileToken('')
      setResetCount((count) => count + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="dialog-panel upload-panel" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <button className="icon-close" onClick={onClose} aria-label="关闭" disabled={busy}>×</button>
        <div className="dialog-topline"><span className="dialog-sticker">♡</span><span>SEND US A LITTLE MEMORY</span></div>
        {success ? (
          <div className="upload-success">
            <span className="success-heart" aria-hidden="true">♥</span>
            <p className="eyebrow">YOUR MEMORY IS SAFE WITH US</p>
            <h2 id="upload-title">回忆收到啦</h2>
            <p>谢谢你把这个瞬间交给我们。审核通过后，它就会出现在对应的相册里。</p>
            <button className="button button-dark" onClick={onClose}>好呀，收下这个拥抱 <span aria-hidden="true">♡</span></button>
          </div>
        ) : (
          <>
            <h2 id="upload-title">投递一段回忆</h2>
            <p className="dialog-intro">一张照片、一张车票，或一段一起玩的录像，都可以。</p>
            <form ref={formRef} className="memory-form" onSubmit={submit}>
              <label className="field-label">放进哪个相册？</label>
              <div className="category-choice">
                {CATEGORIES.map((item) => (
                  <button
                    type="button"
                    className={category === item.id ? 'category-chip selected' : 'category-chip'}
                    onClick={() => {
                      setCategory(item.id)
                      setDuplicateMatches([])
                      setDuplicateScanIncomplete(false)
                      skipDuplicateCheck.current = false
                    }}
                    key={item.id}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <label className="field-label" htmlFor="memory-title">给这一刻起个名字 <span>必填</span></label>
              <input
                id="memory-title"
                className="text-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={100}
                placeholder="比如：又见面啦，或者今天赢了三把"
                required
              />

              <div className="field-row">
                <div className="field-column">
                  <label className="field-label" htmlFor="memory-date">发生的日子 <span>选填</span></label>
                  <input id="memory-date" className="text-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                </div>
                <div className="field-column">
                  <label className="field-label" htmlFor="memory-file">照片或视频 <span>必填</span></label>
                  <label className={files.length ? 'file-pick has-file' : 'file-pick'} htmlFor="memory-file">
                    <span aria-hidden="true">{files.length ? '✓' : '＋'}</span>
                    <span>{files.length ? `已选择 ${files.length} 个文件：${files.map((file) => file.name).join('、')}` : '选择多个文件'}</span>
                  </label>
                  <input
                    id="memory-file"
                    type="file"
                    className="visually-hidden"
                    accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                    multiple
                    onChange={(event) => {
                      setFiles(Array.from(event.currentTarget.files ?? []))
                      setDuplicateMatches([])
                      setDuplicateScanIncomplete(false)
                      skipDuplicateCheck.current = false
                      event.currentTarget.value = ''
                    }}
                  />
                  <small className="field-hint">可多选 JPG、PNG、WebP、GIF、MP4 或 WebM；一次最多 10 个，每个不超过 50 MB</small>
                  <small className="field-hint">提交前会比对本批照片和该相册最近 12 张已公开照片；发现相似项时由你决定是否继续。</small>
                </div>
              </div>

              <label className="field-label" htmlFor="memory-note">再写两句 <span>选填</span></label>
              <textarea
                id="memory-note"
                className="text-input text-area"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={600}
                placeholder="这张照片里，藏着什么小故事？"
                rows={3}
              />

              <div className="turnstile-area">
                {turnstileSiteKey
                  ? <TurnstileWidget siteKey={turnstileSiteKey} resetCount={resetCount} onToken={setTurnstileToken} />
                  : <p className="setup-hint">安全验证将在网站配置完成后显示。</p>}
              </div>

              {duplicateMatches.length > 0 && <div className="duplicate-warning" role="alert">
                <strong>发现 {duplicateMatches.length} 组可能相似的照片，请确认后再提交</strong>
                <ul>
                  {duplicateMatches.slice(0, 5).map((match) => (
                    <li key={match.matchedId + match.uploadedName}>
                      <span>本次选择：{match.uploadedName}</span>
                      <span>{match.fromExistingAlbum ? '相册已有：' : '本次选择中：'}{match.matchedName}</span>
                    </li>
                  ))}
                </ul>
                <small>比对范围：本次选择的照片，以及“{CATEGORIES.find((item) => item.id === category)?.label}”相册最近 {existingPhotoLimit} 张照片。只是提醒，不会自动拦截。</small>
                <div className="duplicate-warning-actions">
                  <button type="button" className="button button-small button-soft" onClick={() => {
                    setFiles([])
                    setDuplicateMatches([])
                    setDuplicateScanIncomplete(false)
                    skipDuplicateCheck.current = false
                  }}>重新选择</button>
                  <button type="button" className="button button-small button-dark" onClick={() => {
                    skipDuplicateCheck.current = true
                    formRef.current?.requestSubmit()
                  }}>仍然提交</button>
                </div>
              </div>}
              {duplicateScanIncomplete && <div className="duplicate-incomplete" role="status">
                部分已有照片暂时无法读取，没能完成完整比对。你可以重新选择文件，或确认后继续提交。
                <button type="button" className="button button-small button-dark" onClick={() => {
                  skipDuplicateCheck.current = true
                  formRef.current?.requestSubmit()
                }}>确认并继续</button>
              </div>}
              {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
              <p className="public-notice"><span aria-hidden="true">♡</span> 投稿通过审核后会公开展示，请不要上传不愿公开的内容。</p>
              <button className="button button-dark submit-button" type="submit" disabled={busy || duplicateMatches.length > 0 || duplicateScanIncomplete}>
                {busy ? <><span className="button-spinner" /> 正在检查或上传…</> : <>提交审核 <span aria-hidden="true">↗</span></>}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

function TurnstileWidget({
  siteKey,
  resetCount,
  onToken,
}: {
  siteKey: string
  resetCount: number
  onToken: (token: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let widgetId: string | null = null
    let disposed = false

    const renderWidget = () => {
      const target = container.current
      if (disposed || !target || !window.turnstile || widgetId) return
      widgetId = window.turnstile.render(target, {
        sitekey: siteKey,
        theme: 'light',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      })
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
    if (window.turnstile) {
      renderWidget()
    } else if (existing) {
      existing.addEventListener('load', renderWidget)
    } else {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.turnstile = 'true'
      script.addEventListener('load', renderWidget)
      document.head.appendChild(script)
    }

    return () => {
      disposed = true
      existing?.removeEventListener('load', renderWidget)
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
      onToken('')
    }
  }, [siteKey, resetCount, onToken])

  return <div ref={container} className="turnstile-widget" />
}

