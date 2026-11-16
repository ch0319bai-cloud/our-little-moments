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
  show_in_dome?: boolean
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
  { id: 'memories', label: '我和宝宝', eyebrow: 'OUR DAYS, OUR TOMORROW', description: '看着曾经一起的日子，期待未来在你身边。' },
  { id: 'portraits', label: '美丽的宝宝', eyebrow: 'MY BEAUTIFUL GIRL', description: '她眼里的光景，还有她最可爱的模样。' },
  { id: 'meetups', label: '每一次相见', eyebrow: 'EVERY JOURNEY BACK TO YOU', description: '每一次出发，都有一张车票通向拥抱。' },
  { id: 'games', label: '未见面的日子', eyebrow: 'WITH YOU, EVEN FROM AFAR', description: '没有见面的日子，也有我在陪你。' },
]
