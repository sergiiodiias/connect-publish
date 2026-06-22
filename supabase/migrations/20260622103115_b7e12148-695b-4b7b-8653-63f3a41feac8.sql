
SELECT cron.unschedule('scheduler-tick');
SELECT cron.unschedule('capture-insights-hourly');

SELECT cron.schedule(
  'scheduler-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4a56b795-e3ab-42a9-8eee-4ca48e008280-dev.lovable.app/api/public/cron/scheduler',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_B6b63rqIUmSWh4VFxgXqww_gsDw5umG"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'capture-insights-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4a56b795-e3ab-42a9-8eee-4ca48e008280-dev.lovable.app/api/public/cron/capture-insights',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_B6b63rqIUmSWh4VFxgXqww_gsDw5umG"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
