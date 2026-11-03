-- Sign in once with this Google account before running this query.
-- Replace the placeholder with the verified Google account email.
do $$
declare
  bootstrap_email text := lower(trim('REPLACE_WITH_GOOGLE_ACCOUNT_EMAIL'));
begin
  if bootstrap_email = 'replace_with_google_account_email'
     or bootstrap_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$' then
    raise exception 'Replace the placeholder with a valid Google account email.';
  end if;

  if not exists (
    select 1
    from auth.users
    where lower(email) = bootstrap_email
      and email_confirmed_at is not null
      and raw_app_meta_data ->> 'provider' = 'google'
  ) then
    raise exception 'Complete Google sign-in with this account before adding it as an administrator.';
  end if;

  insert into public.cartogo_admin_accounts (admin_email)
  values (bootstrap_email)
  on conflict (admin_email) do nothing;
end;
$$;
