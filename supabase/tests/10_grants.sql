-- Supabase grants these to the API roles by default; the migrations assume it.
-- Runs AFTER the migrations, since the tables have to exist first.
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

-- Two test users.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
