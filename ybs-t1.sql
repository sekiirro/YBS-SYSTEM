SET search_path = public;
SELECT id, name, client_id, workspace_id, is_archived, status, created_at, updated_at
FROM nutrition_plans
WHERE created_at > now() - interval '90 minutes'
ORDER BY created_at DESC;
