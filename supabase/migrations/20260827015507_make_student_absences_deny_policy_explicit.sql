-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

CREATE POLICY student_absences_deny_direct_access ON public.student_absences
  USING (false)
  WITH CHECK (false);