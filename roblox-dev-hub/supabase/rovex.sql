-- Rovex Hub : base en ligne des IDs d'accès (projet Supabase « rovex-hub »).
-- À coller dans Supabase → SQL Editor → Run. Peut être relancé sans risque.
-- Les tables sont dans un schéma privé (non exposé par l'API) ; l'app ne passe que par les fonctions rovex_*.
create schema if not exists rovex;

create table if not exists rovex.config (
  id int primary key default 1 check (id = 1),
  master_hash text,
  claimed_at timestamptz
);
insert into rovex.config (id) values (1) on conflict do nothing;

create table if not exists rovex.codes (
  id text primary key,
  code text unique not null,
  label text not null default '',
  admin boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked boolean not null default false,
  last_used timestamptz,
  uses int not null default 0
);

create table if not exists rovex.shared (
  name text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table rovex.config enable row level security;
alter table rovex.codes enable row level security;
alter table rovex.shared enable row level security;

create or replace function rovex.h(t text) returns text language sql immutable set search_path = '' as
$$ select encode(extensions.digest(convert_to(t, 'UTF8'), 'sha256'), 'hex') $$;

create or replace function rovex.norm(t text) returns text language sql immutable set search_path = '' as
$$ select upper(regexp_replace(coalesce(t, ''), '\s', '', 'g')) $$;

create or replace function rovex.is_master(k text) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from rovex.config where master_hash is not null and master_hash = rovex.h(rovex.norm(k))) $$;

create or replace function rovex.valid_code(k text) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from rovex.codes c where c.code = rovex.norm(k) and not c.revoked and (c.expires_at is null or c.expires_at > now())) $$;

create or replace function rovex.is_admin(k text) returns boolean language sql stable security definer set search_path = '' as
$$ select rovex.is_master(k) or exists (select 1 from rovex.codes c where c.code = rovex.norm(k) and c.admin and not c.revoked and (c.expires_at is null or c.expires_at > now())) $$;

create or replace function rovex.code_json(c rovex.codes) returns jsonb language sql stable set search_path = '' as
$$ select jsonb_build_object('id', c.id, 'code', c.code, 'label', c.label, 'admin', c.admin, 'createdAt', c.created_at,
  'expiresAt', c.expires_at, 'revoked', c.revoked, 'lastUsed', c.last_used, 'uses', c.uses) $$;

create or replace function rovex.answer(k text, touch boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c rovex.codes;
begin
  if rovex.is_master(k) then
    return jsonb_build_object('ok', true, 'role', 'admin', 'label', 'Admin', 'master', true, 'permanent', true);
  end if;
  select * into c from rovex.codes where code = rovex.norm(k);
  if not found then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if c.revoked then return jsonb_build_object('ok', false, 'err', 'idBlocked'); end if;
  if c.expires_at is not null and c.expires_at <= now() then return jsonb_build_object('ok', false, 'err', 'idExpired'); end if;
  if touch then update rovex.codes set uses = uses + 1, last_used = now() where id = c.id; end if;
  return jsonb_build_object('ok', true, 'role', case when c.admin then 'admin' else 'user' end, 'id', c.id, 'label', c.label,
    'expiresAt', c.expires_at, 'permanent', c.expires_at is null);
end $$;

-- ---------- API appelée par l'app ----------

create or replace function public.rovex_status() returns jsonb language sql stable security definer set search_path = '' as
$$ select jsonb_build_object('claimed', (select master_hash is not null from rovex.config)) $$;

-- Le premier PC admin enregistre sa clé admin permanente ; ensuite seule cette clé est la clé principale.
create or replace function public.rovex_claim(p_key text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text := rovex.norm(p_key);
begin
  if k !~ '^ADMIN-[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$' then return jsonb_build_object('ok', false, 'err', 'badKey'); end if;
  update rovex.config set master_hash = rovex.h(k), claimed_at = now() where master_hash is null;
  if found then return jsonb_build_object('ok', true, 'claimed', true); end if;
  return jsonb_build_object('ok', rovex.is_master(k), 'claimed', false);
end $$;

create or replace function public.rovex_login(p_code text) returns jsonb language sql security definer set search_path = '' as
$$ select rovex.answer(p_code, true) $$;

create or replace function public.rovex_check(p_code text) returns jsonb language sql security definer set search_path = '' as
$$ select rovex.answer(p_code, false) $$;

create or replace function public.rovex_codes(p_key text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not rovex.is_admin(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  return jsonb_build_object('ok', true, 'codes', coalesce((select jsonb_agg(rovex.code_json(c) order by c.created_at desc) from rovex.codes c), '[]'::jsonb));
end $$;

create or replace function public.rovex_create(p_key text, p_code text, p_label text, p_days int, p_admin boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c rovex.codes;
begin
  if not rovex.is_admin(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  if rovex.norm(p_code) !~ '^(RDH|ADMIN)-[A-Z0-9]{4}(-[A-Z0-9]{4}){2,4}$' then return jsonb_build_object('ok', false, 'err', 'badKey'); end if;
  insert into rovex.codes (id, code, label, admin, expires_at)
  values (substr(md5(random()::text || clock_timestamp()::text), 1, 12), rovex.norm(p_code), left(coalesce(p_label, ''), 60), coalesce(p_admin, false),
          case when coalesce(p_days, 0) <= 0 then null else now() + make_interval(days => p_days) end)
  returning * into c;
  return jsonb_build_object('ok', true, 'code', rovex.code_json(c));
end $$;

create or replace function public.rovex_update(p_key text, p_id text, p_revoked boolean default null, p_add_days int default null, p_permanent boolean default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c rovex.codes;
begin
  if not rovex.is_admin(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  update rovex.codes set
    revoked = coalesce(p_revoked, revoked),
    expires_at = case when p_permanent then null
                      when p_add_days is not null and expires_at is not null then greatest(now(), expires_at) + make_interval(days => p_add_days)
                      else expires_at end
  where id = p_id returning * into c;
  if not found then return jsonb_build_object('ok', false, 'err', 'idNotFound'); end if;
  return jsonb_build_object('ok', true, 'code', rovex.code_json(c));
end $$;

create or replace function public.rovex_delete(p_key text, p_id text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not rovex.is_admin(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  delete from rovex.codes where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Envoie en ligne les IDs créés avant, quand ils n'existaient que sur le PC de l'admin.
create or replace function public.rovex_import(p_key text, p_codes jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not rovex.is_master(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  insert into rovex.codes (id, code, label, admin, created_at, expires_at, revoked, last_used, uses)
  select x->>'id', rovex.norm(x->>'code'), left(coalesce(x->>'label', ''), 60), coalesce((x->>'admin')::boolean, false),
         coalesce((x->>'createdAt')::timestamptz, now()), (x->>'expiresAt')::timestamptz, coalesce((x->>'revoked')::boolean, false),
         (x->>'lastUsed')::timestamptz, coalesce((x->>'uses')::int, 0)
  from jsonb_array_elements(p_codes) x
  where rovex.norm(x->>'code') ~ '^(RDH|ADMIN)-[A-Z0-9]{4}(-[A-Z0-9]{4}){2,4}$'
  on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'imported', n);
end $$;

create or replace function public.rovex_reset_master(p_key text, p_new text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not rovex.is_master(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  if rovex.norm(p_new) !~ '^ADMIN-[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$' then return jsonb_build_object('ok', false, 'err', 'badKey'); end if;
  update rovex.config set master_hash = rovex.h(rovex.norm(p_new)), claimed_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- Contenu publié par les admins (exemples, skills, prompts), lisible avec un ID valide.
create or replace function public.rovex_get_shared(p_code text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (rovex.is_master(p_code) or rovex.valid_code(p_code)) then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  return jsonb_build_object('ok', true, 'shared', coalesce((select jsonb_object_agg(name, jsonb_build_object('data', data, 'updatedAt', updated_at)) from rovex.shared), '{}'::jsonb));
end $$;

create or replace function public.rovex_put_shared(p_key text, p_name text, p_data jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not rovex.is_admin(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  if p_name not in ('examples', 'skills', 'prompts') then return jsonb_build_object('ok', false, 'err', 'badName'); end if;
  insert into rovex.shared (name, data, updated_at) values (p_name, p_data, now())
  on conflict (name) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Garde le projet gratuit éveillé (appelé par l'algo GitHub toutes les heures).
create or replace function public.rovex_ping() returns text language sql stable set search_path = '' as $$ select 'ok' $$;

select 'Rovex Hub : base des IDs prête ✅' as resultat;
