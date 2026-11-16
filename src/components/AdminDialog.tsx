import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES } from '../types'
import type { Submission } from '../types'

interface ReviewItem extends Submission {
  previewUrl: string | null
  show_in_dome: boolean
}

export function AdminDialog({
  onClose,
  onChanged,
  recoveryMode = false,
  onRecoveryComplete,
}: {
  onClose: () => void
  onChanged: () => Promise<void>
  recoveryMode?: boolean
  onRecoveryComplete?: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [items, setItems] = useState<ReviewItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [domeSelection, setDomeSelection] = useState<Set<string>>(() => new Set())
  const [hasDomeColumn, setHasDomeColumn] = useState(false)
  const [publishedItems, setPublishedItems] = useState<ReviewItem[]>([])
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [isRecovery, setIsRecovery] = useState(recoveryMode || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery')

  useEffect(() => {
    if (recoveryMode) setIsRecovery(true)
  }, [recoveryMode])

  const loadQueue = useCallback(async () => {
    if (!supabase) return
    const client = supabase
    setLoading(true)
    let { data, error } = await client
      .from('memories')
      .select('id,category,title,note,occurred_at,media_type,media_path,created_at,show_in_dome')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    if (error) {
      const fallback = await client
        .from('memories')
        .select('id,category,title,note,occurred_at,media_type,media_path,created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      data = fallback.data as typeof data
      error = fallback.error
      setHasDomeColumn(false)
    } else {
      setHasDomeColumn(true)
    }
    if (error) {
      setMessage('暂时无法读取待审核投稿，请确认管理员权限已配置。')
      setItems([])
      setLoading(false)
      return
    }
    const previews = await Promise.all((data ?? []).map(async (item) => {
      const { data: signed } = await client.storage
        .from('couple-memories')
        .createSignedUrl(item.media_path, 60 * 60)
      return { ...item, show_in_dome: item.show_in_dome === true, previewUrl: signed?.signedUrl ?? null } as ReviewItem
    }))
    setItems(previews)
    setSelectedIds((current) => new Set([...current].filter((id) => previews.some((item) => item.id === id))))
    setDomeSelection((current) => new Set([...current].filter((id) => previews.some((item) => item.id === id))))
    setLoading(false)
  }, [])

  const loadPublished = useCallback(async () => {
    if (!supabase) return
    const client = supabase
    setLoading(true)
    let { data, error } = await client
      .from('memories')
      .select('id,category,title,note,occurred_at,media_type,media_path,created_at,show_in_dome')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
    if (error) {
      const fallback = await client
        .from('memories')
        .select('id,category,title,note,occurred_at,media_type,media_path,created_at')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
      data = fallback.data as typeof data
      error = fallback.error
      setHasDomeColumn(false)
    } else {
      setHasDomeColumn(true)
    }
    if (error) {
      setMessage('暂时无法读取已公开的回忆。')
      setPublishedItems([])
      setLoading(false)
      return
    }
    const previews = await Promise.all((data ?? []).map(async (item) => {
      const { data: signed } = await client.storage.from('couple-memories').createSignedUrl(item.media_path, 60 * 60)
      return { ...item, previewUrl: signed?.signedUrl ?? null } as ReviewItem
    }))
    setPublishedItems(previews)
    setLoading(false)
  }, [])

  const verifySession = useCallback(async () => {
    if (!supabase) return false
    const { data, error } = await supabase.rpc('is_admin')
    if (error || data !== true) {
      await supabase.auth.signOut()
      setIsSignedIn(false)
      setMessage('这个账号还没有相册管理权限。请使用已添加为管理员的邮箱登录。')
      return false
    }
    setIsSignedIn(true)
    setMessage('')
    await Promise.all([loadQueue(), loadPublished()])
    return true
  }, [loadQueue, loadPublished])

  useEffect(() => {
    let active = true
    const restore = async () => {
      if (!supabase) {
        setMessage('云端相册还没有配置。完成 README 中的云端设置后即可登录审核。')
        return
      }
      const { data } = await supabase.auth.getSession()
      if (active && data.session && !isRecovery) await verifySession()
    }
    void restore()
    return () => { active = false }
  }, [verifySession, isRecovery])

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) {
      setMessage('云端相册还没有配置。')
      return
    }
    setBusy(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      setMessage('登录失败，请检查邮箱和密码。')
      setBusy(false)
      return
    }
    const ok = await verifySession()
    if (ok) setPassword('')
    setBusy(false)
  }

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMessage('密码更新失败，请重新打开最新的重置邮件链接后再试。')
    } else {
      await supabase.auth.signOut()
      window.history.replaceState(null, '', window.location.pathname + window.location.search + '#manage')
      setIsRecovery(false)
      onRecoveryComplete?.()
      setPassword('')
      setMessage('新密码已设置，请用新密码登录。')
    }
    setBusy(false)
  }

  const updateStatus = async (item: ReviewItem, status: 'approved' | 'rejected') => {
    if (!supabase) return
    setBusy(true)
    const changes = hasDomeColumn
      ? { status, show_in_dome: status === 'approved' && item.media_type === 'image' && domeSelection.has(item.id) }
      : { status }
    const { error } = await supabase.from('memories').update(changes).eq('id', item.id)
    if (error) setMessage('保存失败，请重试。')
    else {
      setMessage(status === 'approved' ? '这段回忆已经公开啦。' : '投稿已放入拒绝区。')
      await loadQueue()
      void onChanged()
    }
    setBusy(false)
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((current) => current.size === items.length
      ? new Set()
      : new Set(items.map((item) => item.id)))
  }

  const bulkUpdateStatus = async (status: 'approved' | 'rejected') => {
    if (!supabase) return
    const ids = items.filter((item) => selectedIds.has(item.id)).map((item) => item.id)
    if (ids.length === 0) return
    if (status === 'rejected' && !window.confirm('确定拒绝所选的 ' + ids.length + ' 份投稿吗？')) return
    setBusy(true)
    setMessage('')
    const domeIds = ids.filter((id) => domeSelection.has(id))
    const regularIds = ids.filter((id) => !domeSelection.has(id))
    const updates = !hasDomeColumn
      ? [await supabase.from('memories').update({ status }).in('id', ids)]
      : status === 'approved'
      ? await Promise.all([
          ...(domeIds.length ? [supabase.from('memories').update({ status, show_in_dome: true }).in('id', domeIds)] : []),
          ...(regularIds.length ? [supabase.from('memories').update({ status, show_in_dome: false }).in('id', regularIds)] : []),
        ])
      : [await supabase.from('memories').update({ status, show_in_dome: false }).in('id', ids)]
    if (updates.some((result) => result.error)) {
      setMessage('批量审核未能全部保存，请刷新列表检查后重试。')
    } else {
      setSelectedIds(new Set())
      setDomeSelection(new Set())
      setMessage(status === 'approved' ? '已通过 ' + ids.length + ' 份投稿并公开。' : '已拒绝 ' + ids.length + ' 份投稿。')
      await loadQueue()
      void onChanged()
    }
    setBusy(false)
  }

  const toggleDomeSelection = (id: string) => {
    setDomeSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const togglePublishedDome = async (item: ReviewItem) => {
    if (!supabase || !hasDomeColumn || item.media_type !== 'image') return
    const showInDome = !item.show_in_dome
    setBusy(true)
    const { error } = await supabase.from('memories').update({ show_in_dome: showInDome }).eq('id', item.id).eq('status', 'approved')
    if (error) {
      setMessage('穹顶照片集保存失败，请重试。')
    } else {
      setPublishedItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, show_in_dome: showInDome } : entry))
      setMessage(showInDome ? '已加入穹顶照片集。' : '已从穹顶照片集中移除。')
      void onChanged()
    }
    setBusy(false)
  }

  const removeItem = async (item: ReviewItem) => {
    if (!supabase) return
    if (!window.confirm('确定删除这段回忆吗？照片或视频和记录都会被永久删除。')) return
    setBusy(true)
    const { error: fileError } = await supabase.storage.from('couple-memories').remove([item.media_path])
    if (fileError) {
      setMessage('媒体文件删除失败，请重试。')
      setBusy(false)
      return
    }
    const { error } = await supabase.from('memories').delete().eq('id', item.id)
    if (error) setMessage('记录删除失败，请刷新后检查。')
    else {
      setMessage('投稿和文件都已删除。')
      await Promise.all([loadQueue(), loadPublished()])
      void onChanged()
    }
    setBusy(false)
  }

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut()
    setIsSignedIn(false)
    setItems([])
    setSelectedIds(new Set())
    setDomeSelection(new Set())
    setPublishedItems([])
    setMessage('已安全退出。')
  }

  const countText = items.length === 1 ? '1 份投稿等你看看' : items.length + ' 份投稿等你看看'

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="dialog-panel admin-panel" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <button className="icon-close" onClick={onClose} aria-label="关闭" disabled={busy}>×</button>
        <div className="dialog-topline"><span className="dialog-sticker">✿</span><span>OUR LITTLE LOVE ARCHIVE</span></div>
        {!isSignedIn ? (
          <div className="admin-login">
            <p className="eyebrow">JUST FOR THE TWO OF US</p>
            <h2 id="admin-title">{isRecovery ? '设置新密码' : '管理员登录'}</h2>
            <p className="dialog-intro">{isRecovery ? '请设置一个新密码，然后返回登录。' : '登录后可以审核访客投稿，决定哪些回忆放进公开相册。'}</p>
            {isRecovery ? (
              <form className="memory-form" onSubmit={updatePassword}>
                <label className="field-label" htmlFor="admin-password">新密码</label>
                <input id="admin-password" className="text-input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
                {message && <p className="form-error" role="alert">{message}</p>}
                <button className="button button-dark submit-button" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存新密码'}</button>
              </form>
            ) : (
              <form className="memory-form" onSubmit={signIn}>
                <label className="field-label" htmlFor="admin-email">邮箱</label>
                <input id="admin-email" className="text-input" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
                <label className="field-label" htmlFor="admin-password">密码</label>
                <input id="admin-password" className="text-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                {message && <p className="form-error" role="alert">{message}</p>}
                <button className="button button-dark submit-button" type="submit" disabled={busy}>
                  {busy ? '正在登录…' : <>进入审核台 <span aria-hidden="true">↗</span></>}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="review-dashboard">
            <div className="review-heading">
              <div>
                <p className="eyebrow">MEMORIES TO REVIEW</p>
                <h2 id="admin-title">待审核投稿</h2>
                <p>{countText}</p>
              </div>
              <button className="text-button" onClick={() => void signOut()}>退出登录 ↗</button>
            </div>
            {message && <p className="inline-message" role="status">{message}</p>}
            {loading ? (
              <div className="review-empty">正在翻看投稿…</div>
            ) : items.length === 0 ? (
              <div className="review-empty">
                <span className="review-empty-heart" aria-hidden="true">♡</span>
                <strong>目前没有待审核的投稿</strong>
                <span>访客提交的新回忆会出现在这里。</span>
              </div>
            ) : (
              <>
              <div className="review-bulk-toolbar">
                <label className="review-select-all">
                  <input type="checkbox" checked={items.length > 0 && selectedIds.size === items.length} onChange={toggleSelectAll} disabled={busy} />
                  <span>{selectedIds.size === items.length ? '取消全选' : '全选'}</span>
                </label>
                <span className="review-selection-count">已选 {selectedIds.size} 份 · 可逐项选择是否加入穹顶</span>
                <div className="review-bulk-actions">
                  <button className="button button-small button-dark" onClick={() => void bulkUpdateStatus('approved')} disabled={busy || selectedIds.size === 0}>批量通过</button>
                  <button className="button button-small button-soft" onClick={() => void bulkUpdateStatus('rejected')} disabled={busy || selectedIds.size === 0}>批量拒绝</button>
                </div>
              </div>
              <div className="review-list">
                {items.map((item) => {
                  const category = CATEGORIES.find((value) => value.id === item.category)
                  return (
                    <article className={'review-card' + (selectedIds.has(item.id) ? ' is-selected' : '')} key={item.id}>
                      <div className="review-preview">
                        {item.previewUrl && item.media_type === 'video'
                          ? <video src={item.previewUrl} controls preload="metadata" />
                          : item.previewUrl
                            ? <img src={item.previewUrl} alt={item.title} />
                            : <span>预览暂不可用</span>}
                      </div>
                      <div className="review-detail">
                        <label className="review-dome-choice">
                          <input type="checkbox" checked={hasDomeColumn && domeSelection.has(item.id)} onChange={() => toggleDomeSelection(item.id)} disabled={busy || !hasDomeColumn || item.media_type !== 'image'} />
                          <span>{hasDomeColumn ? '加入穹顶照片集' : '完成数据库配置后可选入穹顶'}</span>
                        </label>
                        <label className="review-select">
                          <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelected(item.id)} disabled={busy} />
                          <span>选中这份投稿</span>
                        </label>
                        <div className="review-meta"><span>{category?.label ?? '回忆'}</span><time>{formatDate(item.occurred_at)}</time></div>
                        <h3>{item.title}</h3>
                        {item.note && <p>{item.note}</p>}
                        <div className="review-actions">
                          <button className="button button-small button-dark" onClick={() => void updateStatus(item, 'approved')} disabled={busy}>通过公开</button>
                          <button className="button button-small button-soft" onClick={() => void updateStatus(item, 'rejected')} disabled={busy}>拒绝</button>
                          <button className="button button-small button-delete" onClick={() => void removeItem(item)} disabled={busy}>删除</button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
              </>
            )}
            <div className="review-heading" style={{ marginTop: 32 }}>
              <div>
                <p className="eyebrow">THE MEMORIES WE SHARE</p>
                <h2>已公开回忆</h2>
                <p>{publishedItems.length} 份已公开内容</p>
              </div>
            </div>
            {publishedItems.length === 0 ? (
              <div className="review-empty"><strong>还没有公开的回忆</strong><span>审核通过的照片和视频会出现在这里。</span></div>
            ) : (
              <div className="review-list">
                {publishedItems.map((item) => {
                  const category = CATEGORIES.find((value) => value.id === item.category)
                  return (
                    <article className="review-card" key={'published-' + item.id}>
                      <div className="review-preview">
                        {item.previewUrl && item.media_type === 'video'
                          ? <video src={item.previewUrl} controls preload="metadata" />
                          : item.previewUrl
                            ? <img src={item.previewUrl} alt={item.title} />
                            : <span>预览暂不可用</span>}
                      </div>
                      <div className="review-detail">
                        <label className="review-dome-choice">
                          <input type="checkbox" checked={hasDomeColumn && item.show_in_dome} onChange={() => void togglePublishedDome(item)} disabled={busy || !hasDomeColumn || item.media_type !== 'image'} />
                          <span>{!hasDomeColumn ? '完成数据库配置后可管理穹顶照片' : item.show_in_dome ? '已加入穹顶照片集' : item.media_type === 'image' ? '加入穹顶照片集' : '穹顶只展示照片'}</span>
                        </label>
                        <div className="review-meta"><span>{category?.label ?? '回忆'}</span><time>{formatDate(item.occurred_at)}</time></div>
                        <h3>{item.title}</h3>
                        {item.note && <p>{item.note}</p>}
                        <div className="review-actions">
                          <button className="button button-small button-delete" onClick={() => void removeItem(item)} disabled={busy}>删除这段回忆</button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return '未填写日期'
  const date = new Date(value + 'T12:00:00')
  return Number.isNaN(date.getTime())
    ? '未填写日期'
    : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

