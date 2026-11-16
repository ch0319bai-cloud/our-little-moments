export type Category = 'memories' | 'portraits' | 'meetups' | 'games'
export type MediaKind = 'image' | 'video'

export interface MemoryItem {
  id: string
  category: Category
  title: string
  note: string | null
  occurred_at: string | null
  media_type: string
  media_url: string
  created_at: string
}

export interface Submission {
  id: string
  category: Category
  title: string
  note: string | null
  occurred_at: string | null
  media_type: string
  media_path: string
  created_at: string
}

export const CATEGORIES: { id: Category; label: string; eyebrow: string; description: string }[] = [
  { id: 'memories', label: '我和宝宝', eyebrow: 'LITTLE MOMENTS', description: '那些一想起来，心里就软软的日常。' },
  { id: 'portraits', label: '美丽的宝宝', eyebrow: 'HER CAMERA ROLL', description: '她眼里的光景，还有她最可爱的模样。' },
  { id: 'meetups', label: '每一次相见', eyebrow: 'ON OUR WAY', description: '每一次出发，都有一张车票通向拥抱。' },
  { id: 'games', label: '未见面的日子', eyebrow: 'PLAYER TWO', description: '一起打游戏时，笑到停不下来的瞬间。' },
]
