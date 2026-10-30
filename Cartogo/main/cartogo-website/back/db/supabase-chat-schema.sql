create table if not exists public.chat_sessions (
  id text primary key,
  username text not null default 'Guest',
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.chat_sessions add column if not exists username text not null default 'Guest';
alter table public.chat_sessions
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.chat_sessions enable row level security;

drop policy if exists "Public can create and update chat sessions" on public.chat_sessions;
drop policy if exists "Public can update chat sessions" on public.chat_sessions;
drop policy if exists "Public can read chat sessions" on public.chat_sessions;
drop policy if exists "Public can delete chat sessions" on public.chat_sessions;
drop policy if exists "Guests can create chat sessions" on public.chat_sessions;
drop policy if exists "Guests can update unbound chat sessions" on public.chat_sessions;
drop policy if exists "Guests can read unbound chat sessions" on public.chat_sessions;
drop policy if exists "Guests can delete unbound chat sessions" on public.chat_sessions;
drop policy if exists "Authenticated users can create chat sessions" on public.chat_sessions;
drop policy if exists "Authenticated users can update chat sessions" on public.chat_sessions;
drop policy if exists "Authenticated users can read chat sessions" on public.chat_sessions;

create policy "Guests can create chat sessions"
  on public.chat_sessions
  for insert
  to anon
  with check (user_id is null);

create policy "Guests can update unbound chat sessions"
  on public.chat_sessions
  for update
  to anon
  using (user_id is null)
  with check (user_id is null);

create policy "Guests can read unbound chat sessions"
  on public.chat_sessions
  for select
  to anon
  using (user_id is null);

create policy "Authenticated users can create chat sessions"
  on public.chat_sessions
  for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

create policy "Authenticated users can update chat sessions"
  on public.chat_sessions
  for update
  to authenticated
  using (user_id is null or user_id = auth.uid())
  with check (user_id is null or user_id = auth.uid());

create policy "Authenticated users can read chat sessions"
  on public.chat_sessions
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_cartogo_admin());

create policy "Guests can delete unbound chat sessions"
  on public.chat_sessions
  for delete
  to anon
  using (user_id is null);