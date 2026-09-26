SET search_path = public;

SELECT section, id, name, client_id, workspace_id, is_archived, status, created_at, updated_at
FROM (
  SELECT 'NUTRITION_recent' AS section, n.id::text AS id, n.name AS name,
         n.client_id::text AS client_id, n.workspace_id::text AS workspace_id,
         n.is_archived::text AS is_archived, n.status AS status,
         n.created_at::text AS created_at, n.updated_at::text AS updated_at
  FROM nutrition_plans n
  WHERE n.created_at > now() - interval '90 minutes'

  UNION ALL

  SELECT 'WORKOUT_recent', w.id::text, w.name, w.client_id::text, w.workspace_id::text,
         w.is_archived::text, NULL::text, w.created_at::text, w.updated_at::text
  FROM workout_plans w
  WHERE w.created_at > now() - interval '90 minutes'

  UNION ALL

  SELECT 'NUTRITION_dups_recent', name, client_id::text || ' | ' || workspace_id::text,
         row_count::text, NULL, NULL, NULL, NULL, NULL
  FROM (
    SELECT name, client_id, workspace_id, count(*) AS row_count
    FROM nutrition_plans
    WHERE created_at > now() - interval '90 minutes'
    GROUP BY name, client_id, workspace_id
    HAVING count(*) > 1
  ) d

  UNION ALL

  SELECT 'WORKOUT_dups_recent', name, client_id::text || ' | ' || workspace_id::text,
         row_count::text, NULL, NULL, NULL, NULL, NULL
  FROM (
    SELECT name, client_id, workspace_id, count(*) AS row_count
    FROM workout_plans
    WHERE created_at > now() - interval '90 minutes'
    GROUP BY name, client_id, workspace_id
    HAVING count(*) > 1
  ) d

  UNION ALL

  SELECT 'ABUSE_id_is_client_id', 'nutrition_plans', count(*)::text, NULL, NULL, NULL, NULL, NULL, NULL
  FROM nutrition_plans WHERE id = client_id

  UNION ALL

  SELECT 'ABUSE_id_is_client_id', 'workout_plans', count(*)::text, NULL, NULL, NULL, NULL, NULL, NULL
  FROM workout_plans WHERE id = client_id
) all_rows
ORDER BY section, created_at DESC NULLS LAST;