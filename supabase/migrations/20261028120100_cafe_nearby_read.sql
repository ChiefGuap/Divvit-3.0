-- mp_cafes is readable column by column; the nearby places (public OpenStreetMap
-- data) are shown on café cards, so startups need to read them.
grant select (nearby) on public.mp_cafes to anon, authenticated;
