-- Rovex Hub : génération d'images et de sons partagée (la clé OpenAI / ElevenLabs de l'admin sert à tous).
-- À coller dans Supabase → SQL Editor → Run, après rovex.sql. Peut être relancé sans risque.
-- Chaque ID a une limite par jour (modifiable dans l'app, page Studio IA) ; les admins n'ont pas de limite.

alter table rovex.config add column if not exists gen_images_per_day int not null default 20;
alter table rovex.config add column if not exists gen_sounds_per_day int not null default 20;

create table if not exists rovex.gen_usage (
  who text not null,           -- empreinte de l'ID (jamais l'ID en clair)
  day date not null default current_date,
  kind text not null,          -- 'image' ou 'sound'
  n int not null default 0,
  primary key (who, day, kind)
);
alter table rovex.gen_usage enable row level security;

-- Vérifie qu'un ID peut générer p_n éléments aujourd'hui ; p_commit = true les décompte (après la génération).
create or replace function public.rovex_gen_allow(p_code text, p_kind text, p_n int, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_who text := rovex.h(rovex.norm(p_code));
  v_admin boolean;
  v_limit int;
  v_used int;
begin
  if p_kind not in ('image', 'sound') then return jsonb_build_object('ok', false, 'err', 'badKind'); end if;
  if not (rovex.is_master(p_code) or rovex.valid_code(p_code)) then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  v_admin := rovex.is_admin(p_code);
  select case when p_kind = 'image' then gen_images_per_day else gen_sounds_per_day end into v_limit from rovex.config where id = 1;
  select n into v_used from rovex.gen_usage where who = v_who and day = current_date and kind = p_kind;
  v_used := coalesce(v_used, 0);
  if not v_admin and v_used + greatest(p_n, 0) > v_limit then
    return jsonb_build_object('ok', false, 'err', 'genQuota', 'limit', v_limit, 'used', v_used);
  end if;
  if p_commit and p_n > 0 then
    insert into rovex.gen_usage (who, day, kind, n) values (v_who, current_date, p_kind, p_n)
    on conflict (who, day, kind) do update set n = rovex.gen_usage.n + excluded.n;
    v_used := v_used + p_n;
  end if;
  return jsonb_build_object('ok', true, 'unlimited', v_admin, 'limit', v_limit, 'used', v_used);
end $$;

-- Ce qu'il reste aujourd'hui à un ID (affiché dans le Studio IA).
create or replace function public.rovex_gen_status(p_code text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('image', public.rovex_gen_allow(p_code, 'image', 0), 'sound', public.rovex_gen_allow(p_code, 'sound', 0))
$$;

-- Limites par jour, réglables par un admin.
create or replace function public.rovex_gen_set_limits(p_key text, p_images int, p_sounds int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not rovex.is_admin(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  update rovex.config set gen_images_per_day = greatest(0, least(coalesce(p_images, gen_images_per_day), 1000)),
                          gen_sounds_per_day = greatest(0, least(coalesce(p_sounds, gen_sounds_per_day), 1000)) where id = 1;
  return jsonb_build_object('ok', true);
end $$;

select 'Rovex Hub : génération partagée prête ✅' as resultat;
