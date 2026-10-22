alter table public.cartogo_admin_accounts
  add column if not exists is_owner boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from public.cartogo_admin_accounts
    where admin_email = 'remuelfernan07@gmail.com'
  ) then
    raise exception 'The designated owner must already exist in cartogo_admin_accounts.';
  end if;

  update public.cartogo_admin_accounts
  set is_owner = (admin_email = 'remuelfernan07@gmail.com');
end;
$$;

create unique index if not exists cartogo_admin_accounts_single_owner
  on public.cartogo_admin_accounts (is_owner)
  where is_owner;

create or replace function public.get_cartogo_owner_email()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_email text;
begin
  if not public.is_cartogo_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select admin_email into owner_email
  from public.cartogo_admin_accounts
  where is_owner;

  if owner_email is null then
    raise exception 'No owner account is configured.';
  end if;
  return owner_email;
end;
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
  if exists (
    select 1 from public.cartogo_admin_accounts
    where admin_email = normalized_email and is_owner
  ) then
    raise exception 'The owner account cannot be removed.' using errcode = '22023';
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

revoke all on function public.get_cartogo_owner_email() from public, anon;
grant execute on function public.get_cartogo_owner_email() to authenticated;
revoke all on function public.add_cartogo_admin_email(text) from public, anon, authenticated;
revoke all on function public.remove_cartogo_admin_email(text) from public, anon, authenticated;
grant execute on function public.add_cartogo_admin_email(text) to service_role;
grant execute on function public.remove_cartogo_admin_email(text) to service_role;

do $$
begin
  if to_regclass('public.chat_sessions') is not null then
    execute 'drop policy if exists "Public can delete chat sessions" on public.chat_sessions';
    execute 'revoke delete on public.chat_sessions from anon, authenticated';
  end if;
end;
$$;
