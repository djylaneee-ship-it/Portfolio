-- Rovex Hub : leçons partagées (atelier d'apprentissage). Un admin peut publier ses leçons validées pour tous.
-- À coller dans Supabase → SQL Editor → Run. Peut être relancé sans risque.
-- Ajoute le nom « lessons » au contenu partagé (les autres noms restent acceptés).
create or replace function public.rovex_put_shared(p_key text, p_name text, p_data jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not rovex.is_admin(p_key) then return jsonb_build_object('ok', false, 'err', 'adminOnly'); end if;
  if p_name not in ('examples', 'skills', 'prompts', 'textures', 'lessons') then return jsonb_build_object('ok', false, 'err', 'badName'); end if;
  insert into rovex.shared (name, data, updated_at) values (p_name, p_data, now())
  on conflict (name) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

select 'Rovex Hub : leçons partagées ✅' as resultat;
