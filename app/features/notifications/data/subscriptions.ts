import { getSupabase } from "~/shared/supabase/client";

/**
 * Realtime applies RLS to INSERT and UPDATE but not DELETE, so an unfiltered `*` subscription would wake every client
 * on every user's deletions. Scope to this recipient and the two events that change the inbox; focus revalidation covers deletions.
 */
export function subscribeToNotifications(
  recipientProfileId: number,
  onChange: () => void,
): () => void {
  const supabase = getSupabase();
  const filter = `recipient_profile_id=eq.${recipientProfileId}`;
  let active = true;
  const notify = () => {
    if (active) onChange();
  };
  const channel = supabase
    .channel(`my-notifications:${recipientProfileId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter },
      notify,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "notifications", filter },
      notify,
    )
    .subscribe();

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}
