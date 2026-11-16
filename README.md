# 我们的日常 · 情侣回忆相册

一页式中文回忆网站，使用 Vite + React + TypeScript 构建。访客可以浏览已通过审核的回忆，也可以提交图片或视频；管理员登录后审核投稿。

## 本地预览

需要安装 Node.js（包含 npm）。

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

云端未配置时，网站仍可预览版式和空相册；投稿、登录和云端内容需要先完成下面的配置。

## 一、创建 Supabase 项目

1. 在 Supabase 创建一个项目。
2. 打开项目的 SQL Editor，将 `supabase/migrations/202611160001_initial.sql` 全文粘贴执行。
3. 在 Authentication 的用户管理中，分别邀请你和女朋友的邮箱并设置登录密码。
4. 在 SQL Editor 将两位用户的 UUID 加入管理员名单：

```sql
insert into public.admin_users (user_id)
values
  ('替换成第一位管理员的用户UUID'),
  ('替换成第二位管理员的用户UUID');
```

迁移脚本会创建私有媒体存储桶、单文件 50 MB 上限、允许的媒体类型和数据库权限。待审核媒体不会出现在公开相册；公开内容通过短时签名链接读取。

## 二、配置公开投稿验证

1. 在 Cloudflare Turnstile 创建一个网站组件。公开站点主机名（例如 `你的用户名.github.io`）加入允许主机名。
2. 在 GitHub Pages 工作流第一次发布后，用实际站点域名配置 Turnstile；本地预览可另外允许 `localhost`。
3. 安装并登录 Supabase CLI，关联项目后，设置 Edge Function 密钥并部署函数：

```powershell
supabase login
supabase link --project-ref 你的项目引用
supabase secrets set TURNSTILE_SECRET_KEY=你的Turnstile私钥
supabase secrets set TURNSTILE_HOSTNAMES=你的用户名.github.io,localhost
supabase secrets set ALLOWED_ORIGINS=https://你的用户名.github.io,http://localhost:5173
supabase functions deploy public-submit
supabase functions deploy public-gallery
```

不要把 Turnstile 私钥、Supabase service-role key 或其他服务端密钥写入仓库。Supabase Edge Functions 会使用项目的服务端密钥；它不会进入网站前端。

## 三、发布到 GitHub Pages

1. 将本目录提交到 GitHub 仓库的 `main` 分支。
2. 在仓库的 **Settings → Pages** 中将发布方式设为 **GitHub Actions**。
3. 在 **Settings → Secrets and variables → Actions → Variables** 添加以下变量：

| 变量名 | 来源 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable/anon key |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile sitekey |

4. 推送到 `main` 后，工作流会自动构建并发布。前端的 Supabase publishable/anon key 会出现在浏览器中，这是预期行为；访问权限由数据库策略和 Edge Function 控制。绝不要把 service-role key 放入这些前端变量。
5. 用最终 Pages 域名更新 Supabase Auth 的允许重定向 URL，并把域名加入上一步的 `ALLOWED_ORIGINS` 与 Turnstile 主机名列表。更新函数密钥后重新部署 Edge Functions。

## 内容流程

- 访客可在四个分类中选择投稿：我们的回忆、她的镜头、奔赴见面、并肩开黑。
- 支持 JPG、PNG、WebP、GIF、MP4 和 WebM；单个文件最多 50 MB。投稿需要完成 Turnstile 验证。
- 投稿先进入私有存储和待审核列表；管理员在页面页脚的“小小管理员”入口登录。
- 通过审核后内容才会出现在公开相册。拒绝的投稿仍为私有；删除操作会同时移除记录和媒体文件。
- 本项目素材中目前只有静态 JPG 乌萨奇图片，没有动图，也没有你们的照片、车票或游戏视频；相关分类以空相册状态呈现，后续可直接投稿真实素材。
