alter table public.inquiries
  add column if not exists pickup_time time,
  add column if not exists rental_days smallint,
  add column if not exists discount_percent smallint,
  add column if not exists discount_amount numeric(12, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inquiries_rental_days_check') then
    alter table public.inquiries
      add constraint inquiries_rental_days_check
      check (rental_days is null or rental_days between 4 and 15);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inquiries_discount_percent_check') then
    alter table public.inquiries
      add constraint inquiries_discount_percent_check
      check (discount_percent is null or discount_percent in (0, 5, 10));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inquiries_discount_amount_check') then
    alter table public.inquiries
      add constraint inquiries_discount_amount_check
      check (discount_amount is null or discount_amount >= 0);
  end if;
end;
$$;
