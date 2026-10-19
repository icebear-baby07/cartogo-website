alter table public.inquiries
  add column if not exists target_latitude numeric(9, 6),
  add column if not exists target_longitude numeric(9, 6),
  add column if not exists nearest_pickup_name text,
  add column if not exists nearest_pickup_distance_km numeric(8, 3),
  add column if not exists rate_region text,
  add column if not exists rental_period_hours smallint,
  add column if not exists estimated_rental_hours integer,
  add column if not exists rate_per_period numeric(10, 2),
  add column if not exists quoted_rate numeric(12, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inquiries_target_coordinates_check') then
    alter table public.inquiries
      add constraint inquiries_target_coordinates_check
      check (
        (target_latitude is null and target_longitude is null)
        or
        (target_latitude between -90 and 90 and target_longitude between -180 and 180)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inquiries_nearest_pickup_distance_check') then
    alter table public.inquiries
      add constraint inquiries_nearest_pickup_distance_check
      check (nearest_pickup_distance_km is null or nearest_pickup_distance_km >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inquiries_rate_region_check') then
    alter table public.inquiries
      add constraint inquiries_rate_region_check
      check (rate_region is null or rate_region in ('in', 'out', 'luzon'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inquiries_rental_period_hours_check') then
    alter table public.inquiries
      add constraint inquiries_rental_period_hours_check
      check (rental_period_hours is null or rental_period_hours in (12, 24));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inquiries_estimated_rental_hours_check') then
    alter table public.inquiries
      add constraint inquiries_estimated_rental_hours_check
      check (estimated_rental_hours is null or estimated_rental_hours > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inquiries_rates_nonnegative_check') then
    alter table public.inquiries
      add constraint inquiries_rates_nonnegative_check
      check (
        (rate_per_period is null or rate_per_period >= 0)
        and (quoted_rate is null or quoted_rate >= 0)
      );
  end if;
end;
$$;