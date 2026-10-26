-- Rovex Hub : un ID = un seul appareil connecté à la fois, et l'historique des appareils de chaque ID.
-- À coller dans Supabase → SQL Editor → Run, après rovex.sql. Peut être relancé sans risque.
-- La clé admin principale n'est pas concernée (elle n'est pas dans rovex.codes).

alter table rovex.codes add column if not exists active_device text;
alter table rovex.codes add column if not exists active_device_name text;
alter table rovex.codes add column if not exists active_since timestamptz;

-- Chaque appareil qui s'est connecté (ou a essayé) avec un ID.
create table if not exists rovex.devices (
  code_id text not null references rovex.codes(id) on delete cascade,
  device text not null,
  name text not null default '',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  logins int not null default 0,
  primary key (code_id, device)
);
alter table rovex.devices enable row level security;

create or replace function rovex.code_json(c rovex.codes) returns jsonb language sql stable security definer set search_path = '' as
$$ select jsonb_build_object('id', c.id, 'code', c.code, 'label', c.label, 'admin', c.admin, 'createdAt', c.created_at,
  'expiresAt', c.expires_at, 'revoked', c.revoked, 'lastUsed', c.last_used, 'uses', c.uses,
  'activeDevice', c.active_device_name, 'activeSince', c.active_since,
  'devices', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'firstSeen', d.first_seen, 'lastSeen', d.last_seen, 'logins', d.logins,
                                                           'active', d.device = c.active_device) order by d.last_seen desc)
                       from rovex.devices d where d.code_id = c.id), '[]'::jsonb)) $$;

-- Connexion (touch = true) ou vérification (touch = false), avec l'appareil.
-- Connexion : l'appareil devient l'appareil actif de l'ID (l'ancien sera déconnecté à sa prochaine vérification).
-- Vérification : refusée si un autre appareil est devenu l'appareil actif.
create or replace function rovex.answer(k text, touch boolean, p_device text default null, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c rovex.codes;
begin
  if rovex.is_master(k) then
    return jsonb_build_object('ok', true, 'role', 'admin', 'label', 'Admin', 'master', true, 'permanent', true);
  end if;
  select * into c from rovex.codes where code = rovex.norm(k);
  if not found then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if p_device is not null and p_device <> '' then
    insert into rovex.devices (code_id, device, name, logins) values (c.id, left(p_device, 64), left(coalesce(p_name, ''), 80), case when touch then 1 else 0 end)
    on conflict (code_id, device) do update set last_seen = now(), name = coalesce(nullif(excluded.name, ''), rovex.devices.name),
      logins = rovex.devices.logins + case when touch then 1 else 0 end;
  end if;
  if c.revoked then return jsonb_build_object('ok', false, 'err', 'idBlocked'); end if;
  if c.expires_at is not null and c.expires_at <= now() then return jsonb_build_object('ok', false, 'err', 'idExpired'); end if;
  if touch then
    update rovex.codes set uses = uses + 1, last_used = now(),
      active_device = coalesce(nullif(left(p_device, 64), ''), active_device),
      active_device_name = case when coalesce(p_device, '') <> '' then left(coalesce(p_name, ''), 80) else active_device_name end,
      active_since = case when coalesce(p_device, '') <> '' then now() else active_since end
    where id = c.id;
  elsif p_device is not null and p_device <> '' and c.active_device is not null and c.active_device <> p_device then
    return jsonb_build_object('ok', false, 'err', 'otherDevice', 'device', c.active_device_name);
  end if;
  return jsonb_build_object('ok', true, 'role', case when c.admin then 'admin' else 'user' end, 'id', c.id, 'label', c.label,
    'expiresAt', c.expires_at, 'permanent', c.expires_at is null);
end $$;

-- Anciennes versions sans appareil : remplacées par celles-ci (les anciennes apps continuent de marcher).
drop function if exists public.rovex_login(text);
drop function if exists public.rovex_check(text);
drop function if exists rovex.answer(text, boolean);

create or replace function public.rovex_login(p_code text, p_device text default null, p_name text default null) returns jsonb
language sql security definer set search_path = '' as
$$ select rovex.answer(p_code, true, p_device, p_name) $$;

create or replace function public.rovex_check(p_code text, p_device text default null) returns jsonb
language sql security definer set search_path = '' as
$$ select rovex.answer(p_code, false, p_device, null) $$;

-- L'admin déconnecte un ID de son appareil (la personne devra se reconnecter).
create or replace function public.rovex_kick(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not rovex.is_admin(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  update rovex.codes set active_device = 'kicked-' || md5(random()::text), active_device_name = '', active_since = now() where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'err', 'idNotFound'); end if;
  return jsonb_build_object('ok', true);
end $$;

select 'Rovex Hub : un appareil par ID ✅' as resultat;
