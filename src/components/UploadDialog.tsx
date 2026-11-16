import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CATEGORIES, type Category } from '../types'
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

export function UploadDialog({
  initialCategory,
  onClose,
  onSubmitted,
}: {
  initialCategory: Category
  onClose: () => void
  onSubmitted: () => Promise<void>
}) {
  const [category, setCategory] = useState<Category>(initialCategory)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [resetCount, setResetCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')
    if (!isCloudConfigured || !supabase) {
      setErrorMessage('云端相册还没有接好，完成配置后就可以投稿啦。')
      return
    }
    if (!file) {
      setErrorMessage('先选一张照片或一段视频吧。')
      return
    }
    if (!allowedTypes.includes(file.type)) {
      setErrorMessage('支持 JPG、PNG、WebP、GIF、MP4 和 WebM 格式。')
      return
    }
    if (file.size > maxBytes) {
      setErrorMessage('单个文件请控制在 50 MB 以内。')
      return
    }
    if (!turnstileToken) {
      setErrorMessage('请先完成下面的小小安全验证。')
      return
    }

    setBusy(true)
    try {
      const { data: prepared, error: prepareError } = await supabase.functions.invoke('public-submit', {
        body: {
          action: 'prepare',
          category,
          title: title.trim(),
          occurredAt: date || null,
          note: note.trim(),
          mimeType: file.type,
          fileSize: file.size,
          turnstileToken,
        },
      })
      if (prepareError) throw new Error(prepareError.message)
      if (!prepared?.intentId || !prepared?.path || !prepared?.token) {
        throw new Error(prepared?.error || '暂时无法准备上传，请稍后再试。')
      }

      const { error: uploadError } = await supabase.storage
        .from('couple-memories')
        .uploadToSignedUrl(prepared.path, prepared.token, file, {
          contentType: file.type,
          upsert: false,
        })
      if (uploadError) {
        await supabase.functions.invoke('public-submit', {
          body: { action: 'cancel', intentId: prepared.intentId },
        })
        throw new Error(uploadError.message)
      }

      const { data: finalized, error: finalizeError } = await supabase.functions.invoke('public-submit', {
        body: { action: 'finalize', intentId: prepared.intentId },
      })
      if (finalizeError || finalized?.error) {
        await supabase.functions.invoke('public-submit', {
          body: { action: 'cancel', intentId: prepared.intentId },
        })
        throw new Error(finalized?.error || finalizeError?.message || '提交没有完成，请再试一次。')
      }

      setSuccess(true)
      setFile(null)
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
        <div className="dialog-topline"><span className="dialog-sticker">♡</span><span>LEAVE A LITTLE MEMORY</span></div>
        {success ? (
          <div className="upload-success">
            <span className="success-heart" aria-hidden="true">♥</span>
            <p className="eyebrow">SAFELY SENT</p>
            <h2 id="upload-title">回忆收到啦</h2>
            <p>谢谢你把这个瞬间交给我们。审核通过后，它就会出现在对应的相册里。</p>
            <button className="button button-dark" onClick={onClose}>好呀，收下这个拥抱 <span aria-hidden="true">♡</span></button>
          </div>
        ) : (
          <>
            <h2 id="upload-title">投递一段回忆</h2>
            <p className="dialog-intro">一张照片、一张车票，或一段一起玩的录像，都可以。</p>
            <form className="memory-form" onSubmit={submit}>
              <label className="field-label">放进哪个相册？</label>
              <div className="category-choice">
                {CATEGORIES.map((item) => (
                  <button
                    type="button"
                    className={category === item.id ? 'category-chip selected' : 'category-chip'}
                    onClick={() => setCategory(item.id)}
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
                  <label className={file ? 'file-pick has-file' : 'file-pick'} htmlFor="memory-file">
                    <span aria-hidden="true">{file ? '✓' : '＋'}</span>
                    <span>{file ? file.name : '选择一个文件'}</span>
                  </label>
                  <input
                    id="memory-file"
                    type="file"
                    className="visually-hidden"
                    accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    required
                  />
                  <small className="field-hint">JPG、PNG、WebP、GIF、MP4 或 WebM，最多 50 MB</small>
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

              {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
              <p className="public-notice"><span aria-hidden="true">♡</span> 投稿通过审核后会公开展示，请不要上传不愿公开的内容。</p>
              <button className="button button-dark submit-button" type="submit" disabled={busy}>
                {busy ? <><span className="button-spinner" /> 正在收好这段回忆…</> : <>提交审核 <span aria-hidden="true">↗</span></>}
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
