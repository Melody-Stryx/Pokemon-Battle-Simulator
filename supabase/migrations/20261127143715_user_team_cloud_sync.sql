create table if not exists public.user_teams (
  user_id uuid primary key references auth.users(id) on delete cascade,
  teams jsonb not null default '[]'::jsonb,
  folders jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_teams_teams_is_array check (jsonb_typeof(teams) = 'array'),
  constraint user_teams_folders_is_array check (jsonb_typeof(folders) = 'array')
);

alter table public.user_teams enable row level security;

create policy "Users can read their own teams"
  on public.user_teams for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own teams"
  on public.user_teams for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own teams"
  on public.user_teams for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists user_teams_updated_at_idx on public.user_teams (updated_at desc);
