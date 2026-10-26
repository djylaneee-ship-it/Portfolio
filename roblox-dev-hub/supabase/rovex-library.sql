-- Rovex Hub : la grande bibliothèque en ligne. L'exploration (GitHub Actions, en continu) y ajoute ce
-- qu'elle trouve ; chaque app récupère les nouveautés toutes les 5 minutes avec son ID d'accès.
-- À coller dans Supabase → SQL Editor → Run, après rovex.sql. Peut être relancé sans risque,
-- mais chaque lancement crée une NOUVELLE clé d'exploration (à remettre dans GitHub).

create table if not exists rovex.library (
  seq bigserial primary key,           -- ordre d'arrivée : les apps demandent « tout ce qui est après n »
  url_hash text not null unique,       -- une ressource par adresse
  data jsonb not null,                 -- titre, adresse, miniature, auteur, catégorie, type, description, tags…
  created_at timestamptz not null default now()
);
alter table rovex.library enable row level security;

alter table rovex.config add column if not exists crawler_hash text;
alter table rovex.config add column if not exists library_max int not null default 700000; -- garde-fou du plan gratuit (500 Mo)

-- Ajout par l'exploration (clé d'exploration) ou par un admin. Les doublons sont ignorés.
create or replace function public.rovex_lib_push(p_key text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_added int := 0;
  v_count bigint;
  v_max int;
begin
  if not ((select crawler_hash from rovex.config where id = 1) = rovex.h(p_key) or rovex.is_admin(p_key)) then
    return jsonb_build_object('ok', false, 'err', 'adminOnly');
  end if;
  if jsonb_typeof(p_items) <> 'array' then return jsonb_build_object('ok', false, 'err', 'badItems'); end if;
  select library_max into v_max from rovex.config where id = 1;
  -- Estimation rapide du nombre de lignes (un count(*) à chaque envoi serait trop lent).
  select greatest(reltuples, 0)::bigint into v_count from pg_catalog.pg_class where oid = 'rovex.library'::regclass;
  if v_count >= v_max then return jsonb_build_object('ok', false, 'err', 'libraryFull', 'count', v_count); end if;
  with ins as (
    insert into rovex.library (url_hash, data)
    select rovex.h(it->>'url'), it
    from jsonb_array_elements(p_items) as it
    where coalesce(it->>'url', '') <> '' and coalesce(it->>'title', '') <> '' and length(it::text) < 8000
    on conflict (url_hash) do nothing
    returning 1
  )
  select count(*) into v_added from ins;
  return jsonb_build_object('ok', true, 'added', v_added, 'count', v_count + v_added);
end $$;

-- Nouveautés depuis le numéro p_since (pour un ID valide), par paquets.
create or replace function public.rovex_lib_since(p_code text, p_since bigint, p_limit int default 2000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_items jsonb;
begin
  if not (rovex.is_master(p_code) or rovex.valid_code(p_code)) then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  select coalesce(jsonb_agg(l.data || jsonb_build_object('seq', l.seq) order by l.seq), '[]'::jsonb) into v_items
  from (select seq, data from rovex.library where seq > coalesce(p_since, 0) order by seq limit least(greatest(coalesce(p_limit, 2000), 1), 5000)) l;
  return jsonb_build_object('ok', true, 'items', v_items, 'last', coalesce((select max(seq) from rovex.library), 0));
end $$;

-- Taille de la bibliothèque en ligne.
create or replace function public.rovex_lib_stats(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not (rovex.is_master(p_code) or rovex.valid_code(p_code) or (select crawler_hash from rovex.config where id = 1) = rovex.h(p_code)) then
    return jsonb_build_object('ok', false, 'err', 'unknownId');
  end if;
  return jsonb_build_object('ok', true, 'count', (select count(*) from rovex.library), 'last', coalesce((select max(seq) from rovex.library), 0),
    'max', (select library_max from rovex.config where id = 1), 'size', pg_size_pretty(pg_total_relation_size('rovex.library')));
end $$;

-- Nouvelle clé d'exploration : à copier dans GitHub (Settings → Secrets → Actions → ROVEX_CRAWLER_KEY).
create or replace function rovex.new_crawler_key() returns text
language plpgsql security definer set search_path = '' as $$
declare k text := 'CRAWL-' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  update rovex.config set crawler_hash = rovex.h(k) where id = 1;
  return k;
end $$;
revoke all on function rovex.new_crawler_key() from public, anon, authenticated;

select rovex.new_crawler_key() as cle_exploration_a_copier_dans_github;
