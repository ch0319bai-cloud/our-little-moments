create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.upload_intents (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('memories', 'portraits', 'meetups', 'games')),
  title text not null,
  note text,
  occurred_at date,
  media_type text not null check (media_type in ('image', 'video')),
  media_path text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('memories', 'portraits', 'meetups', 'games')),
  title text not null,
  note text,
  occurred_at date,
  media_type text not null check (media_type in ('image', 'video')),
  media_path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
alter table public.upload_intents enable row level security;
alter table public.memories enable row level security;

revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.upload_intents from anon, authenticated;
revoke all on table public.memories from anon, authenticated;

grant select, update, delete on table public.memories to authenticated;

drop policy if exists "admins read all memories" on public.memories;
create policy "admins read all memories"
  on public.memories for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "admins update memories" on public.memories;
create policy "admins update memories"
  on public.memories for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "admins delete memories" on public.memories;
create policy "admins delete memories"
  on public.memories for delete to authenticated
  using ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'couple-memories',
  'couple-memories',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admins read couple memories" on storage.objects;
create policy "admins read couple memories"
  on storage.objects for select to authenticated
  using (bucket_id = 'couple-memories' and (select public.is_admin()));

drop policy if exists "admins delete couple memories" on storage.objects;
create policy "admins delete couple memories"
  on storage.objects for delete to authenticated
  using (bucket_id = 'couple-memories' and (select public.is_admin()));
