/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Edge-only JSR modules are checked by Deno. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.111.0";
import {
  type CleanupItem,
  createCleanupHandler,
  type RemoveResult,
} from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cleanupSecret = Deno.env.get("STORAGE_CLEANUP_SECRET") ?? "";

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function claim(): Promise<CleanupItem[]> {
  if (!url || !serviceRoleKey) throw new Error("missing_server_configuration");
  const { data, error } = await supabase.rpc("claim_storage_cleanup", {
    p_limit: 100,
    p_lease_seconds: 300,
  });
  if (error) throw error;
  return (data ?? []) as CleanupItem[];
}

async function remove(bucket: string, paths: string[]): Promise<RemoveResult> {
  const { data, error } = await supabase.storage.from(bucket).remove(paths);
  return {
    removedPaths: ((data ?? []) as { name: string }[]).map(
      (object) => object.name,
    ),
    error: error ? error.message : null,
  };
}

async function complete(
  leaseId: string,
  ids: string[],
  removedIds: string[],
  error: string | null,
): Promise<number> {
  const { data, error: rpcError } = await supabase.rpc(
    "complete_storage_cleanup",
    {
      p_lease_id: leaseId,
      p_ids: ids,
      p_removed_ids: removedIds,
      p_error: error,
    },
  );
  if (rpcError) throw rpcError;
  return Number(data ?? 0);
}

Deno.serve(
  createCleanupHandler({
    expectedSecret: cleanupSecret,
    claim,
    remove,
    complete,
  }),
);
