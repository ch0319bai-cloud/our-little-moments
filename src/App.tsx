import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AdminDialog } from './components/AdminDialog'
import { UploadDialog } from './components/UploadDialog'
import DomeGallery from './components/DomeGallery'
import { supabase } from './lib/supabase'
import { CATEGORIES } from './types'
import type { Category, MemoryItem } from './types'

const usagiByCategory: Record<Category, string> = {
  memories: './usagi/apple-usagi.jpg',
  portraits: './usagi/peek-usagi.jpg',
  meetups: './usagi/dancing-usagi.jpg',
  games: './usagi/mascot.jpg',
}
const usagiDomePreview = [
  './usagi/sunset-usagi.jpg',
  './usagi/peek-usagi.jpg',
  './usagi/apple-usagi.jpg',
  './usagi/dancing-usagi.jpg',
  './usagi/mascot.jpg',
]

function App() {
  const [entries, setEntries] = useState<MemoryItem[]>([])
  const [activeSection, setActiveSection] = useState<Category>('memories')
  const [isLoading, setIsLoading] = useState(true)
  const [uploadCategory, setUploadCategory] = useState<Category | null>(null)
  const [lightbox, setLightbox] = useState<MemoryItem | null>(null)
  const isRecoveryLink = () => new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'
  const [passwordRecovery, setPasswordRecovery] = useState(isRecoveryLink())
  const [adminOpen, setAdminOpen] = useState(window.location.hash === '#manage' || isRecoveryLink())

  const loadGallery = useCallback(async () => {
    if (!supabase) {
      setEntries([])
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    const { data, error } = await supabase.functions.invoke('public-gallery', { body: {} })
    if (!error && Array.isArray(data?.entries)) setEntries(data.entries as MemoryItem[])
    setIsLoading(false)
  }, [])

  useEffect(() => { void loadGallery() }, [loadGallery])
  useEffect(() => {
    const observer = new IntersectionObserver((observations) => {
      const visible = observations.find((observation) => observation.isIntersecting)
      if (visible) setActiveSection(visible.target.id as Category)
    }, { rootMargin: '-20% 0px -70% 0px' })
    CATEGORIES.forEach((category) => {
      const section = document.getElementById(category.id)
      if (section) observer.observe(section)
    })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
        setAdminOpen(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])
  useEffect(() => {
    const handleHash = () => setAdminOpen(window.location.hash === '#manage' || isRecoveryLink())
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightbox(null)
        setUploadCategory(null)
        if (adminOpen) closeAdmin()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [adminOpen])

  const openAdmin = () => { window.location.hash = 'manage'; setAdminOpen(true) }
  const closeAdmin = () => {
    setAdminOpen(false)
    if (window.location.hash === '#manage') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }
  const openUpload = (category: Category) => setUploadCategory(category)
  const domePhotos = entries
    .filter((entry) => entry.media_type === 'image')
    .map((entry) => ({ src: entry.media_url, alt: entry.title }))
  const domeImages = domePhotos.length ? domePhotos : usagiDomePreview

  return (
    <>
    <div className="site-shell">
      <SiteHeader onUpload={() => openUpload('memories')} />
      <main>
        <section className="hero" id="top">
          <div className="hero-copy">
            <span className="eyebrow"><span className="eyebrow-dot" /> A LITTLE SPACE JUST FOR US</span>
            <h1>把小小瞬间<br /><em>收进我们的故事</em></h1>
            <p className="hero-description">从远距离的想念，到并肩走过的日常。<br />每一页，都有我们。</p>
            <div className="hero-actions">
              <a className="button button-dark" href="#memories">翻开回忆 <span aria-hidden="true">↘</span></a>
              <span className="hero-note"><span aria-hidden="true">♡</span> Our days, our way</span>
            </div>
          </div>
          <div className="hero-art">
            <div className="hero-image-wrap">
              <img src="./usagi/sunset-usagi.jpg" alt="乌萨奇在夕阳下的花坡" className="hero-image" />
              <div className="hero-image-shade" />
              <div className="image-caption"><span className="caption-sparkle">✳</span><span>和你一起，平凡也闪闪发光</span></div>
            </div>
            <img className="floating-usagi hero-sticker" src="./usagi/peek-usagi.jpg" alt="" />
            <span className="hero-doodle doodle-star" aria-hidden="true">✳</span>
            <span className="hero-doodle doodle-heart" aria-hidden="true">♡</span>
            <span className="hero-pill"><span className="pill-dot" /> OUR LITTLE JOURNAL</span>
          </div>
          <a className="scroll-cue" href="#chapters" aria-label="向下浏览"><span>↓</span></a>
        </section>

        <section className="chapter-strip" id="chapters" aria-label="回忆分类">
          <div className="section-kicker">THE CHAPTERS <span>·</span> 我们的四个小角落</div>
          <div className="chapter-grid">
            {CATEGORIES.map((category, index) => (
              <a className={'chapter-card chapter-' + category.id} href={'#' + category.id} key={category.id}>
                <span className="chapter-number">0{index + 1}</span>
                <span className="chapter-emoji" aria-hidden="true">{['♡', '✿', '↗', '✦'][index]}</span>
                <strong>{category.label}</strong>
                <span className="chapter-link">去看看 <span aria-hidden="true">↗</span></span>
              </a>
            ))}
          </div>
        </section>

        <section className="quote-band">
          <img src="./usagi/mascot.jpg" alt="" className="quote-mascot" />
          <div className="quote-copy">
            <span className="eyebrow">A NOTE FOR US</span>
            <p>“最好的日子，是和你一起<br className="desktop-break" />把普通过成喜欢的样子。”</p>
          </div>
          <span className="quote-heart" aria-hidden="true">♥</span>
        </section>

        <div className="gallery-sections">
          {CATEGORIES.map((category, index) => (
            <GallerySection
              key={category.id}
              category={category}
              index={index}
              entries={entries.filter((entry) => entry.category === category.id)}
              loading={isLoading}
              onUpload={() => openUpload(category.id)}
              onOpen={setLightbox}
            />
          ))}
        </div>

        <section className="closing-dome" aria-label="我们的回忆圆顶">
          <DomeGallery
            images={domeImages}
            overlayBlurColor="#f4e6c8"
            imageBorderRadius="16px"
            openedImageBorderRadius="24px"
            grayscale={false}
          />
        </section>
      </main>

      <footer className="site-footer">
        <a className="footer-brand" href="#top">
          <img src="./usagi/mascot.jpg" alt="" />
          <span>我们的日常<small>OUR LITTLE JOURNAL</small></span>
        </a>
        <p>把想念收好，把见面记牢。 <span aria-hidden="true">♡</span></p>
        <div className="footer-right">
          <button className="admin-link" onClick={openAdmin}>小小管理员 <span aria-hidden="true">↗</span></button>
          <span className="copyright">© {new Date().getFullYear()} made with love</span>
        </div>
      </footer>

      {uploadCategory && <UploadDialog initialCategory={uploadCategory} onClose={() => setUploadCategory(null)} onSubmitted={loadGallery} />}
      {adminOpen && <AdminDialog onClose={closeAdmin} onChanged={loadGallery} recoveryMode={passwordRecovery} onRecoveryComplete={() => setPasswordRecovery(false)} />}
      {lightbox && <Lightbox item={lightbox} onClose={() => setLightbox(null)} />}
    </div>
    <SectionQuickNav activeSection={activeSection} onSelect={setActiveSection} />
    </>
  )
}

function SectionQuickNav({ activeSection, onSelect }: { activeSection: Category; onSelect: (section: Category) => void }) {
  const icons = ['♡', '✿', '↗', '✦']
  return (
    <nav className="section-quick-nav" aria-label="快速跳转到回忆模块">
      <span className="quick-nav-heading">我们的章节</span>
      {CATEGORIES.map((category, index) => (
        <a
          className={'quick-nav-link' + (activeSection === category.id ? ' is-active' : '')}
          href={'#' + category.id}
          key={category.id}
          aria-current={activeSection === category.id ? 'location' : undefined}
          onClick={() => onSelect(category.id)}
        >
          <span className="quick-nav-icon" aria-hidden="true">{icons[index]}</span>
          <span className="quick-nav-label">{category.label}</span>
        </a>
      ))}
    </nav>
  )
}

function SiteHeader({ onUpload }: { onUpload: () => void }) {
  return (
    <header className="site-header">
      <a href="#top" className="brand" aria-label="回到首页">
        <span className="brand-mark"><img src="./usagi/mascot.jpg" alt="" /></span>
        <span className="brand-name">我们的日常<span>LOVE NOTES</span></span>
      </a>
      <nav className="main-nav" aria-label="主导航">
        <a href="#top">首页</a><a href="#memories">我和宝宝</a><a href="#portraits">美丽的宝宝</a><a href="#meetups">每一次相见</a><a href="#games">未见面的日子</a>
      </nav>
      <button className="header-add" onClick={onUpload}><span aria-hidden="true">＋</span> 留下回忆</button>
    </header>
  )
}

function GallerySection({
  category, index, entries, loading, onUpload, onOpen,
}: {
  category: (typeof CATEGORIES)[number]
  index: number
  entries: MemoryItem[]
  loading: boolean
  onUpload: () => void
  onOpen: (entry: MemoryItem) => void
}) {
  return (
    <section className={'memory-section section-' + category.id} id={category.id}>
      <div className="memory-section-inner">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span className="section-index">0{index + 1}</span> {category.eyebrow}</p>
            <h2>{category.label}<span className="heading-heart" aria-hidden="true">♡</span></h2>
            <p className="section-description">{category.description}</p>
          </div>
          <button className="button button-outline" onClick={onUpload}><span aria-hidden="true">＋</span> 投稿到这里</button>
        </div>

        {loading ? <div className="loading-grid" aria-label="正在加载相册"><span /><span /><span /></div> :
          entries.length > 0 ? <div className="memory-grid">
            {entries.map((entry) => <MemoryCard entry={entry} key={entry.id} onOpen={() => onOpen(entry)} />)}
          </div> :
          <div className="empty-card">
            <div className="empty-art-wrap">
              <span className="empty-sparkle sparkle-one" aria-hidden="true">✳</span>
              <span className="empty-sparkle sparkle-two" aria-hidden="true">♡</span>
              <img src={usagiByCategory[category.id]} alt="" className={'empty-usagi empty-usagi-' + category.id} />
            </div>
            <div className="empty-copy">
              <span className="empty-tag">A LITTLE SPACE FOR THIS STORY</span>
              <h3>{category.id === 'meetups' ? '下一张车票，留给下一次见面' : '这里还空着一个位置'}</h3>
              <p>{category.id === 'meetups' ? '把车票和那天的心情一起收好。' : '等第一份回忆到来，我们就把它好好珍藏。'}</p>
              <button className="text-button" onClick={onUpload}>放进第一份回忆 <span aria-hidden="true">↗</span></button>
            </div>
          </div>}
      </div>
    </section>
  )
}

function MemoryCard({ entry, onOpen }: { entry: MemoryItem; onOpen: () => void }) {
  return (
    <button className="memory-card" onClick={onOpen} aria-label={'查看：' + entry.title}>
      <div className="memory-media">
        {entry.media_type === 'video'
          ? <video src={entry.media_url} preload="metadata" muted playsInline />
          : <img src={entry.media_url} alt={entry.title} loading="lazy" />}
        {entry.media_type === 'video' && <span className="video-indicator" aria-hidden="true">▶ 视频</span>}
      </div>
      <div className="memory-card-copy">
        <div><h3>{entry.title}</h3>{entry.note && <p>{entry.note}</p>}</div>
        <time>{formatDate(entry.occurred_at)}</time>
      </div>
    </button>
  )
}

function Lightbox({ item, onClose }: { item: MemoryItem; onClose: () => void }) {
  const media: ReactNode = item.media_type === 'video'
    ? <video src={item.media_url} controls autoPlay playsInline />
    : <img src={item.media_url} alt={item.title} />
  return (
    <div className="lightbox-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="lightbox-panel" role="dialog" aria-modal="true" aria-label={item.title}>
        <button className="icon-close lightbox-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="lightbox-media">{media}</div>
        <div className="lightbox-caption">
          <div><h2>{item.title}</h2>{item.note && <p>{item.note}</p>}</div>
          <time>{formatDate(item.occurred_at)}</time>
        </div>
      </div>
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return '留住这一刻'
  const date = new Date(value + 'T12:00:00')
  if (Number.isNaN(date.getTime())) return '留住这一刻'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

export default App

