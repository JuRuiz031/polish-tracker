\set ON_ERROR_STOP on
-- RLS isolation, exercised as the `authenticated` role rather than as the owner.
-- A superuser bypasses RLS entirely, so testing this as postgres would prove nothing.

create temp table rls (n serial, outcome text, label text);
-- The results table belongs to postgres; the tests run as `authenticated`.
grant all on rls to authenticated, anon;
grant all on sequence rls_n_seq to authenticated, anon;
create or replace function note(cond boolean, label text) returns void
language plpgsql as $$
begin insert into rls (outcome,label) values (case when cond then 'pass' else 'FAIL' end, label); end $$;
create or replace function tryrls(stmt text, label text, want text) returns void
language plpgsql as $$
declare state text;
begin
  begin execute stmt; state := 'OK';
  exception when others then state := sqlstate; end;
  if want = 'ok' then
    insert into rls (outcome,label) values (case when state='OK' then 'pass' else 'FAIL('||state||')' end, label);
  else
    insert into rls (outcome,label) values (case when state<>'OK' then 'pass['||state||']' else 'FAIL(allowed!)' end, label);
  end if;
end $$;

-- ---- user 1 --------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select tryrls($$insert into polish (brand,name,color,finish) values ('Zoya','Payton','Pink','Shimmer')$$,
  'user1 can insert into their own collection', 'ok');
select note((select count(*) from polish where name='Payton') = 1, 'user1 sees their own row');

-- Stamping someone else's user_id must be refused by WITH CHECK.
select tryrls($$insert into polish (user_id,brand,name,color,finish)
                values ('22222222-2222-2222-2222-222222222222','Zoya','Smuggled','Pink','Shimmer')$$,
  'user1 CANNOT insert a row owned by user2 (with check)', 'fail');

-- ---- user 2 --------------------------------------------------------------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select note((select count(*) from polish) = 0, 'user2 sees NONE of user1 rows (table RLS)');
select note((select count(*) from wear) = 0, 'user2 sees no wear rows');
select note((select count(*) from wishlist) = 0, 'user2 sees no wishlist rows');

-- The views are the classic hole: without security_invoker they run as owner and leak.
select note((select count(*) from polish_stats) = 0, 'user2 sees nothing through polish_stats view');
select note((select count(*) from polish_duplicates) = 0, 'user2 sees nothing through polish_duplicates view');
select note((select count(*) from wishlist_already_owned) = 0, 'user2 sees nothing through wishlist_already_owned view');

-- user2 cannot reach across even by id.
select tryrls($$update polish set notes='hijacked' where name='Payton'$$,
  'user2 update of user1 row affects nothing', 'ok');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select note((select notes is distinct from 'hijacked' from polish where name='Payton'),
  'user1 row was NOT modified by user2');

-- ---- anon ----------------------------------------------------------------
reset role;
set role anon;
select tryrls($$select count(*) from polish$$, 'anon is refused outright (revoked)', 'fail');
reset role;

\echo ''
\echo '======================== RLS ISOLATION ========================'
select outcome, label from rls order by n;
select count(*) filter (where outcome like 'FAIL%') as failures from rls;
