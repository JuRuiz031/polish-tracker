\set ON_ERROR_STOP on
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

create temp table results (n serial, outcome text, label text);

create or replace function try(stmt text, label text, want text) returns void
language plpgsql as $$
declare state text;
begin
  begin
    execute stmt;
    state := 'OK';
  exception when others then
    state := sqlstate;
  end;

  if want = 'ok' then
    insert into results (outcome, label)
      values (case when state = 'OK' then 'pass' else 'FAIL(' || state || ')' end, label);
  else
    insert into results (outcome, label)
      values (case when state <> 'OK' then 'pass[' || state || ']' else 'FAIL(allowed!)' end, label);
  end if;
end $$;

create or replace function check_that(cond boolean, label text) returns void
language plpgsql as $$
begin
  insert into results (outcome, label) values (case when cond then 'pass' else 'FAIL' end, label);
end $$;

-- ===========================================================================
-- 1. The generated column is really gone
-- ===========================================================================
select check_that(
  not exists (select 1 from information_schema.columns
              where table_name in ('polish','wishlist') and column_name = 'dedupe_key'),
  'no dedupe_key column on polish or wishlist');

select check_that(
  not exists (select 1 from information_schema.columns
              where is_generated <> 'NEVER' and table_schema = 'public'),
  'no generated columns anywhere in public');

select check_that(
  (select count(*) from pg_indexes
   where schemaname='public' and indexdef like '%lower(btrim(brand))%') = 2,
  'both dedupe expression indexes exist');

-- ===========================================================================
-- 2. brand / name normalisation CHECK
-- ===========================================================================
select try($$insert into polish (brand,name,color,finish) values ('OPI','Big Apple Red','Red','Cream')$$,
  'normalised brand+name accepted', 'ok');
select try($$insert into polish (brand,name,color,finish) values (' OPI','Trailing','Red','Cream')$$,
  'leading space rejected', 'fail');
select try($$insert into polish (brand,name,color,finish) values ('OPI ','Trailing2','Red','Cream')$$,
  'trailing space rejected', 'fail');
select try($$insert into polish (brand,name,color,finish) values (E'OPI\t','Tabbed','Red','Cream')$$,
  'embedded tab rejected', 'fail');
select try($$insert into polish (brand,name,color,finish) values ('Holo  Taco','Double','Red','Cream')$$,
  'double inner space rejected', 'fail');
select try($$insert into polish (brand,name,color,finish) values ('','Empty','Red','Cream')$$,
  'empty brand rejected', 'fail');
select try($$insert into polish (brand,name,color,finish) values ('Holo Taco','Single Spaces','Red','Cream')$$,
  'single inner spaces accepted', 'ok');

-- ===========================================================================
-- 3. wear bounds
-- ===========================================================================
create temp table ids as
  select id as pid from polish where name = 'Big Apple Red';

select try(format($$insert into wear (polish_id,worn_on,days_lasted) values (%L,'2026-01-01',365)$$,
  (select pid from ids)), 'days_lasted 365 accepted', 'ok');
select try(format($$insert into wear (polish_id,worn_on,days_lasted) values (%L,'2026-01-02',366)$$,
  (select pid from ids)), 'days_lasted 366 rejected', 'fail');
select try(format($$insert into wear (polish_id,worn_on,days_lasted) values (%L,'2026-01-03',-1)$$,
  (select pid from ids)), 'days_lasted -1 rejected', 'fail');
select try(format($$insert into wear (polish_id,worn_on,rating) values (%L,'2026-01-04',5)$$,
  (select pid from ids)), 'rating 5 accepted', 'ok');
select try(format($$insert into wear (polish_id,worn_on,rating) values (%L,'2026-01-05',6)$$,
  (select pid from ids)), 'rating 6 rejected', 'fail');

-- A wear row may not point at another user's polish (composite FK).
select try(format($$insert into wear (user_id,polish_id,worn_on)
                    values ('22222222-2222-2222-2222-222222222222',%L,'2026-01-06')$$,
  (select pid from ids)), 'cross-user wear rejected by composite FK', 'fail');

-- ===========================================================================
-- 4. typical_price vs numeric(10,2)
-- ===========================================================================
select try($$insert into wishlist (brand,name,color,finish,typical_price)
             values ('ILNP','Priced','Red','Cream',99999999.99)$$,
  'typical_price 99999999.99 accepted', 'ok');
select try($$insert into wishlist (brand,name,color,finish,typical_price)
             values ('ILNP','TooBig','Red','Cream',100000000)$$,
  'typical_price 1e8 rejected (22003)', 'fail');
insert into wishlist (brand,name,color,finish,typical_price)
  values ('ILNP','Rounded','Red','Cream',12.345);
select check_that((select typical_price from wishlist where name='Rounded') = 12.35,
  'pg silently rounds 12.345 -> 12.35 (why the client rounds first)');

-- ===========================================================================
-- 5. updated_at trigger — the sync clock
-- ===========================================================================
create temp table clock as select id, updated_at as t0 from polish where name='Big Apple Red';

-- (a) no client value supplied -> now()
update polish set notes = 'a' where name = 'Big Apple Red';
select check_that((select updated_at from polish where name='Big Apple Red') > (select t0 from clock),
  'plain UPDATE bumps updated_at to now()');

-- (b) client supplies an OLDER timestamp -> clamped, must not move backwards
create temp table clock2 as select updated_at as t1 from polish where name='Big Apple Red';
update polish set notes = 'b', updated_at = timestamptz '2001-01-01' where name='Big Apple Red';
select check_that((select updated_at from polish where name='Big Apple Red') = (select t1 from clock2),
  'stale offline write CANNOT move updated_at backwards');

-- (c) client supplies a NEWER timestamp -> honoured verbatim
update polish set notes = 'c', updated_at = timestamptz '2099-01-01 00:00:00+00' where name='Big Apple Red';
select check_that((select updated_at from polish where name='Big Apple Red') = timestamptz '2099-01-01 00:00:00+00',
  'client-supplied newer updated_at is honoured (edit time, not arrival time)');

-- ===========================================================================
-- 6. Client ids: upsert is idempotent, plain insert is not
-- ===========================================================================
select try($$insert into polish (id,brand,name,color,finish)
             values ('33333333-3333-3333-3333-333333333333','Zoya','Storm','Blue','Glitter')$$,
  'insert with client id', 'ok');
select try($$insert into polish (id,brand,name,color,finish)
             values ('33333333-3333-3333-3333-333333333333','Zoya','Storm','Blue','Glitter')$$,
  'REPLAYED plain insert violates PK (not idempotent)', 'fail');
select try($$insert into polish (id,brand,name,color,finish)
             values ('33333333-3333-3333-3333-333333333333','Zoya','Storm','Blue','Glitter')
             on conflict (id) do nothing$$,
  'REPLAYED upsert is a no-op (idempotent)', 'ok');
select check_that((select count(*) from polish where id='33333333-3333-3333-3333-333333333333') = 1,
  'replay left exactly one row');

-- ===========================================================================
-- 7. Wishlist Bought pairing
-- ===========================================================================
select try(format($$insert into wishlist (brand,name,color,finish,bought_polish_id)
                    values ('OPI','BadLink','Red','Cream',%L)$$, (select pid from ids)),
  'link without Bought status rejected', 'fail');
select try($$insert into wishlist (brand,name,color,finish,status)
             values ('OPI','BoughtNoLink','Red','Cream','Bought')$$,
  'Bought without a link allowed (history whose bottle is gone)', 'ok');
select try(format($$insert into wishlist (brand,name,color,finish,status,bought_polish_id,bought_on)
                    values ('OPI','Resolved','Red','Cream','Bought',%L,'2026-08-20')$$,
  (select pid from ids)), 'Bought + link accepted', 'ok');

-- Hard-deleting the polish must null the link and leave the history row standing.
create temp table doomed as
  select id as pid from polish where name = 'Single Spaces';
insert into wishlist (brand,name,color,finish,status,bought_polish_id)
  values ('Holo Taco','WillOrphan','Red','Cream','Bought',(select pid from doomed));
delete from polish where id = (select pid from doomed);
select check_that(
  (select count(*) from wishlist where name='WillOrphan') = 1
  and (select bought_polish_id from wishlist where name='WillOrphan') is null
  and (select status from wishlist where name='WillOrphan')::text = 'Bought',
  'hard delete nulls the link, keeps the Bought history row');

-- ===========================================================================
-- 8. Views
-- ===========================================================================
insert into polish (brand,name,color,finish) values ('essie','Bordeaux','Red','Cream');
insert into polish (brand,name,color,finish) values ('Essie','Bordeaux','Red','Cream');
select check_that((select count(*) from polish_duplicates) = 2,
  'polish_duplicates returns ONLY the duplicate pair, not the whole collection');
select check_that((select count(distinct dedupe_key) from polish_duplicates) = 1,
  'case-different spellings share one dedupe_key');

select check_that(
  not exists (select 1 from information_schema.columns
              where table_name='polish_stats' and column_name='days_since'),
  'polish_stats publishes no UTC days_since');

insert into wishlist (brand,name,color,finish) values ('OPI','Big Apple Red','Red','Cream');
select check_that((select count(*) from wishlist_already_owned where wishlist_id in
                    (select id from wishlist where name='Big Apple Red')) = 1,
  'wishlist_already_owned flags a bottle she owns');
select check_that((select count(*) from wishlist_already_owned where wishlist_id in
                    (select id from wishlist where name='Resolved')) = 0,
  'wishlist_already_owned ignores a row that was Bought');

\echo ''
\echo '================= CONSTRAINTS / TRIGGERS / VIEWS ================='
select outcome, label from results order by n;
select count(*) filter (where outcome like 'FAIL%') as failures from results;
