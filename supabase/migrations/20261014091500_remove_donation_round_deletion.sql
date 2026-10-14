-- Remove donation round deletion without deleting any data.
DROP FUNCTION IF EXISTS public.donation_delete_round(bigint);
