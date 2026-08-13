/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- JSR and Deno globals are resolved by the Edge runtime, not the Node TypeScript project. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface CleanupItem {
  attachment_id: string;
  storage_bucket: string;
  object_path: string;
  lease_id: string;
}

interface GroupMediaCleanupItem {
  media_id: string;
  object_path: string;
  lease_id: string;
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });

  const expectedSecret = Deno.env.get("POST_ATTACHMENT_CLEANUP_SECRET");
  const suppliedSecret = request.headers.get("x-cleanup-secret");
  if (!expectedSecret || suppliedSecret !== expectedSecret)
    return new Response("Unauthorized", { status: 401 });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey)
    return new Response("Missing server configuration", { status: 500 });

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("claim_post_attachment_cleanup", {
    p_limit: 100,
    p_lease_seconds: 300,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const items = (data ?? []) as CleanupItem[];
  const { data: groupMediaData, error: groupMediaError } = await supabase.rpc(
    "claim_group_media_cleanup",
    { p_limit: 100, p_lease_seconds: 300 },
  );
  if (groupMediaError)
    return Response.json({ error: groupMediaError.message }, { status: 500 });
  let removed = 0;
  let failed = 0;

  for (const item of items) {
    const { error: removeError } = await supabase.storage
      .from(item.storage_bucket)
      .remove([item.object_path]);

    // Removing a path that no longer exists is idempotent and counts as success.
    const objectDeleted = !removeError;
    const { error: completeError } = await supabase.rpc(
      "complete_post_attachment_cleanup",
      {
        p_attachment_id: item.attachment_id,
        p_lease_id: item.lease_id,
        p_object_deleted: objectDeleted,
      },
    );

    if (objectDeleted && !completeError) removed += 1;
    else failed += 1;
  }

  const groupMediaItems = (groupMediaData ?? []) as GroupMediaCleanupItem[];
  for (const item of groupMediaItems) {
    const { error: removeError } = await supabase.storage
      .from("group-media")
      .remove([item.object_path]);
    const objectDeleted = !removeError;
    const { error: completeError } = await supabase.rpc(
      "complete_group_media_cleanup",
      {
        p_media_id: item.media_id,
        p_lease_id: item.lease_id,
        p_object_deleted: objectDeleted,
      },
    );
    if (objectDeleted && !completeError) removed += 1;
    else failed += 1;
  }

  console.log("post attachment cleanup completed", {
    claimed: items.length + groupMediaItems.length,
    removed,
    failed,
  });
  return Response.json({
    claimed: items.length + groupMediaItems.length,
    removed,
    failed,
  });
});
