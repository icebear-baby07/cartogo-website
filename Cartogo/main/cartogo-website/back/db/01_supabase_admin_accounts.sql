-- Supabase stores only the administrator sign-in allowlist.
-- Website data, chat sessions, and administrator titles/permissions live in MongoDB.
begin;

create table if not exists public.cartogo_admin_accounts (
  admin_email text primary key check (admin_email = lower(trim(admin_email))),
  added_at timestamptz not null default now()
);

alter table public.cartogo_admin_accounts enable row level security;
revoke all on public.cartogo_admin_accounts from public, anon, authenticated;

create or replace function public.is_cartogo_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cartogo_admin_accounts
    where admin_email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and auth.jwt() -> 'app_metadata' ->> 'provider' = 'google'
      and auth.jwt() -> 'user_metadata' ->> 'email_verified' = 'true'
  );
$$;

create or replace function public.get_cartogo_admin_emails()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(admin_email order by admin_email), array[]::text[])
  from public.cartogo_admin_accounts
  where public.is_cartogo_admin();
$$;

create or replace function public.add_cartogo_admin_email(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Owner approval is required.' using errcode = '42501';
  end if;
  if normalized_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$' then
    raise exception 'Enter a valid administrator email.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users
    where lower(email) = normalized_email
      and email_confirmed_at is not null
      and raw_app_meta_data ->> 'provider' = 'google'
  ) then
    raise exception 'The new administrator must complete Google sign-in before being added.' using errcode = '22023';
  end if;
  insert into public.cartogo_admin_accounts (admin_email)
  values (normalized_email)
  on conflict (admin_email) do nothing;
  return normalized_email;
end;
$$;

create or replace function public.remove_cartogo_admin_email(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
  admin_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Owner approval is required.' using errcode = '42501';
  end if;
  lock table public.cartogo_admin_accounts in exclusive mode;
  select count(*) into admin_count from public.cartogo_admin_accounts;
  if admin_count <= 1 then
    raise exception 'At least one administrator account must remain.' using errcode = '22023';
  end if;
  delete from public.cartogo_admin_accounts where admin_email = normalized_email;
  if not found then
    raise exception 'That administrator account was not found.' using errcode = '22023';
  end if;
  return normalized_email;
end;
$$;

revoke all on function public.is_cartogo_admin() from public;
revoke all on function public.get_cartogo_admin_emails() from public;
revoke all on function public.add_cartogo_admin_email(text) from public, anon, authenticated;
revoke all on function public.remove_cartogo_admin_email(text) from public, anon, authenticated;
grant execute on function public.is_cartogo_admin() to authenticated;
grant execute on function public.get_cartogo_admin_emails() to authenticated;
grant execute on function public.add_cartogo_admin_email(text) to service_role;
grant execute on function public.remove_cartogo_admin_email(text) to service_role;

commit;
