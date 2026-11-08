-- (Optionnel) Relevé automatique des stats Roblox toutes les 5 minutes, même quand personne n'a l'app ouverte.
-- 1. Supabase > Edge Functions > Secrets : ajoute PT_CRON_SECRET = un mot de passe au hasard.
-- 2. Remplace ci-dessous VOTRE-PROJET et LE-MEME-MOT-DE-PASSE, puis lance ce fichier dans SQL Editor.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('pt-roblox-refresh') where exists (select 1 from cron.job where jobname = 'pt-roblox-refresh');
select cron.schedule('pt-roblox-refresh', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://VOTRE-PROJET.supabase.co/functions/v1/pt-roblox',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-pt-cron', 'LE-MEME-MOT-DE-PASSE'),
    body := '{"action":"refresh"}'::jsonb
  );
$$);
-- Garde 60 jours d'historique.
select cron.unschedule('pt-stats-cleanup') where exists (select 1 from cron.job where jobname = 'pt-stats-cleanup');
select cron.schedule('pt-stats-cleanup', '17 3 * * *', $$
  delete from public.pt_game_stats where at < now() - interval '60 days';
  delete from public.pt_game_events where at < now() - interval '60 days';
$$);
