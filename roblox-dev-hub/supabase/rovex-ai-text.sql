-- Rovex Hub : prompts améliorés par Gemini (clé de l'admin) — limite par ID et par jour.
-- À coller dans Supabase → SQL Editor → Run, après rovex-gen.sql. Peut être relancé sans risque.

alter table rovex.config add column if not exists gen_texts_per_day int not null default 50;

-- Même vérification que pour les images, avec en plus le type 'text'.
create or replace function public.rovex_gen_allow(p_code text, p_kind text, p_n int, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_who text := rovex.h(rovex.norm(p_code));
  v_admin boolean;
  v_limit int;
  v_used int;
begin
  if p_kind not in ('image', 'sound', 'text') then return jsonb_build_object('ok', false, 'err', 'badKind'); end if;
  if not (rovex.is_master(p_code) or rovex.valid_code(p_code)) then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  v_admin := rovex.is_admin(p_code);
  select case p_kind when 'image' then gen_images_per_day when 'sound' then gen_sounds_per_day else gen_texts_per_day end
    into v_limit from rovex.config where id = 1;
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

create or replace function public.rovex_gen_status(p_code text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('image', public.rovex_gen_allow(p_code, 'image', 0), 'sound', public.rovex_gen_allow(p_code, 'sound', 0),
                            'text', public.rovex_gen_allow(p_code, 'text', 0))
$$;

-- Les limites par jour, avec maintenant celle des prompts améliorés.
drop function if exists public.rovex_gen_set_limits(text, int, int);
create or replace function public.rovex_gen_set_limits(p_key text, p_images int default null, p_sounds int default null, p_texts int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not rovex.is_admin(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  update rovex.config set gen_images_per_day = greatest(0, least(coalesce(p_images, gen_images_per_day), 1000)),
                          gen_sounds_per_day = greatest(0, least(coalesce(p_sounds, gen_sounds_per_day), 1000)),
                          gen_texts_per_day = greatest(0, least(coalesce(p_texts, gen_texts_per_day), 1000)) where id = 1;
  return jsonb_build_object('ok', true);
end $$;

select 'Rovex Hub : prompts améliorés prêts ✅' as resultat;
