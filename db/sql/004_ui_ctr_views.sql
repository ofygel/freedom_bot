BEGIN;

CREATE OR REPLACE VIEW ui_ctr_daily AS
SELECT
  date_trunc('day', created_at) AS day,
  target,
  count(*) FILTER (WHERE event = 'expose') AS exposures,
  count(*) FILTER (WHERE event = 'click')  AS clicks,
  CASE WHEN count(*) FILTER (WHERE event = 'expose') > 0
       THEN round(100.0 * count(*) FILTER (WHERE event = 'click') / count(*) FILTER (WHERE event = 'expose'), 2)
       ELSE NULL END AS ctr
FROM ui_events
GROUP BY 1,2
ORDER BY 1 DESC, 2;

CREATE OR REPLACE VIEW ui_ctr_overall AS
SELECT
  target,
  count(*) FILTER (WHERE event = 'expose') AS exposures,
  count(*) FILTER (WHERE event = 'click')  AS clicks,
  CASE WHEN count(*) FILTER (WHERE event = 'expose') > 0
       THEN round(100.0 * count(*) FILTER (WHERE event = 'click') / count(*) FILTER (WHERE event = 'expose'), 2)
       ELSE NULL END AS ctr
FROM ui_events
GROUP BY 1
ORDER BY ctr DESC NULLS LAST, exposures DESC;

CREATE OR REPLACE VIEW ui_ctr_by_variant AS
SELECT
  COALESCE(experiment, '-') AS experiment,
  COALESCE(variant, '-')    AS variant,
  target,
  count(*) FILTER (WHERE event = 'expose') AS exposures,
  count(*) FILTER (WHERE event = 'click')  AS clicks,
  CASE WHEN count(*) FILTER (WHERE event = 'expose') > 0
       THEN round(100.0 * count(*) FILTER (WHERE event = 'click') / count(*) FILTER (WHERE event = 'expose'), 2)
       ELSE NULL END AS ctr
FROM ui_events
GROUP BY 1,2,3
ORDER BY 1,2, ctr DESC NULLS LAST, exposures DESC;

COMMIT;
