create table if not exists public.chat_sessions (
  id text primary key,
  username text not null default 'Guest',
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.chat_sessions add column if not exists username text not null default 'Guest';

alter table public.chat_sessions enable row level security;

create policy "Public can create and update chat sessions"
  on public.chat_sessions
  for insert
  to anon
  with check (true);

create policy "Public can update chat sessions"
  on public.chat_sessions
  for update
  to anon
  using (true)
  with check (true);

create policy "Public can read chat sessions"
  on public.chat_sessions
  for select
  to anon
  using (true);

create policy "Public can delete chat sessions"
  on public.chat_sessions
  for delete
  to anon
  using (true);