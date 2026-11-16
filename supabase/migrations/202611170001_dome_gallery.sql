alter table public.memories
  add column if not exists show_in_dome boolean not null default false;

comment on column public.memories.show_in_dome is
  'Whether an approved image should appear in the public rotating dome gallery.';

-- Keep existing approved photo memories in the dome, while excluding meetup
-- ticket and travel uploads by default. Admins can change every image later.
update public.memories
set show_in_dome = true
where status = 'approved'
  and media_type = 'image'
  and category in ('memories', 'portraits', 'games');
