import { getSupabase } from "~/shared/supabase/client";

export function subscribeToNotifications(onChange: () => void): () => void {
  const supabase = getSupabase();
  const channel = supabase
    .channel("my-notifications")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications" },
      onChange,
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
