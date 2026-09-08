-- ============================================================
-- YBS SYSTEM: FIX meal_replacement_requests INSERT RLS (20260908000007)
--
-- Root cause found in live testing:
--   "new row violates row-level security policy for table
--    meal_replacement_requests"
--
-- The original `meal_req_insert` WITH CHECK ended with:
--     AND workspace_id = public.get_client_workspace_id(client_id)
--
-- That compared TWO independent values with no relational anchor:
--   * payload.workspace_id (the app sends the *plan's* workspace_id,
--     see MealReplacementRequestModal.jsx)
--   * clients.workspace_id (the client record's own workspace)
--
-- Nothing guarantees plan.workspace_id == clients.workspace_id (plans are
-- created/assigned in the coach's active workspace and can legitimately
-- differ from the client row's workspace, e.g. template-derived or
-- cross-workspace assignment). When they differ, a 100%-legitimate client
-- request is rejected by this clause, producing the RLS violation above.
-- Conditions 1-4 (is_client_self, requested_by = auth.uid(), pending,
-- valid request_type) are identity-true for a genuine client session.
--
-- The fix derives ALL context from the database instead of payload equality:
-- the client may insert a pending request ONLY for a meal belonging to their
-- OWN assigned nutrition plan (is_client_self + nutrition_plans.client_id +
-- nutrition_meals.nutrition_plan_id). This is strictly narrower per-row, is
-- immune to workspace mismatches, and adds the previously-missing
-- "meal/plan actually belongs to this client" validation.
--
-- Security model is unchanged:
--   * SELECT: own requests / workspace staff / assigned coach (unchanged)
--   * INSERT: own client + own plan + own meal + pending + valid type only
--   * UPDATE / DELETE: still not granted, still no policies
--   * approval/rejection: still only via approve/reject RPCs
-- ============================================================

DROP POLICY IF EXISTS "meal_req_insert" ON public.meal_replacement_requests;

CREATE POLICY "meal_req_insert" ON public.meal_replacement_requests
FOR INSERT TO authenticated
WITH CHECK (
  public.is_client_self(client_id)
  AND requested_by = (select auth.uid())
  AND status = 'pending'
  AND request_type IN ('replacement', 'other')
  AND EXISTS (
    SELECT 1 FROM public.nutrition_plans np
    WHERE np.id = nutrition_plan_id
      AND np.client_id = client_id
      AND np.is_template IS NOT TRUE
  )
  AND EXISTS (
    SELECT 1 FROM public.nutrition_meals nm
    WHERE nm.id = meal_id
      AND nm.nutrition_plan_id = nutrition_plan_id
  )
);