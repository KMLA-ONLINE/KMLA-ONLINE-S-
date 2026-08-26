import { getSupabase } from "~/shared/supabase/client";

/**
 * Realtime applies RLS to INSERT and UPDATE but not to DELETE, so an unfiltered
 * `*` subscription hands every connected client every other user's deletions —
 * the daily retention cleanup would wake the whole app at once. Scope the
 * channel to this recipient and to the two events that can actually change what
 * the inbox and the shell badge show; the focus revalidation covers deletions.
 */
export function subscribeToNotifications(
  recipientProfileId: number,
  onChange: () => void,
): () => void {
  const supabase = getSupabase();
  const filter = `recipient_profile_id=eq.${recipientProfileId}`;
  const channel = supabase
    .channel(`my-notifications:${recipientProfileId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "notifications", filter },
      onChange,
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
