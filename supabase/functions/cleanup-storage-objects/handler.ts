export interface CleanupItem {
  id: string;
  bucket: string;
  object_path: string;
  lease_id: string;
}

export interface RemoveResult {
  /** Storage가 실제로 지웠다고 보고한 경로. 없는 경로는 오류 없이 빠져 있다. */
  removedPaths: string[];
  error: string | null;
}

export interface CleanupTotals {
  claimed: number;
  removed: number;
  failed: number;
}

export interface CleanupDependencies {
  expectedSecret: string;
  claim: () => Promise<CleanupItem[]>;
  remove: (bucket: string, paths: string[]) => Promise<RemoveResult>;
  complete: (
    leaseId: string,
    ids: string[],
    removedIds: string[],
    error: string | null,
  ) => Promise<number>;
}

/**
 * 한 번 claim한 항목을 버킷별로 묶어 한 번에 지운다. 이전 구현은 object 하나마다 Storage 호출과
 * RPC 호출을 각각 한 번씩 했다. 100개를 정리하면 왕복이 200번이었다.
 *
 * `remove`는 **실제로 지운 경로만** 돌려주고 없는 경로에는 오류를 내지 않는다. 그래서 배치를
 * 통째로 성공 처리하면 안 된다 — 일부만 지워진 경우 지워지지 않은 object의 큐 행까지 사라져
 * 추적을 영영 잃는다. 어느 경로가 돌아왔는지 그대로 넘기고, 나머지를 재시도할지 이미 없는
 * 것으로 볼지는 `complete_storage_cleanup`이 storage.objects를 보고 가른다.
 */
export function createCleanupHandler(deps: CleanupDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (
      !deps.expectedSecret ||
      request.headers.get("x-cleanup-secret") !== deps.expectedSecret
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    let items: CleanupItem[];
    try {
      items = await deps.claim();
    } catch {
      return Response.json({ error: "claim_failed" }, { status: 500 });
    }

    const totals: CleanupTotals = {
      claimed: items.length,
      removed: 0,
      failed: 0,
    };

    const byBucket = new Map<string, CleanupItem[]>();
    for (const item of items) {
      const bucket = byBucket.get(item.bucket);
      if (bucket) bucket.push(item);
      else byBucket.set(item.bucket, [item]);
    }

    for (const [bucket, bucketItems] of byBucket) {
      // claim은 호출 한 번에 하나의 리스를 준다. 배치가 갈려도 리스는 같다.
      const leaseId = bucketItems[0].lease_id;
      const ids = bucketItems.map((item) => item.id);

      let result: RemoveResult;
      try {
        result = await deps.remove(
          bucket,
          bucketItems.map((item) => item.object_path),
        );
      } catch (cause) {
        result = { removedPaths: [], error: String(cause) };
      }

      const removedPaths = new Set(result.removedPaths);
      const removedIds = bucketItems
        .filter((item) => removedPaths.has(item.object_path))
        .map((item) => item.id);

      let completed: number;
      try {
        completed = await deps.complete(leaseId, ids, removedIds, result.error);
      } catch {
        // 리스가 만료되면 다음 실행이 같은 항목을 다시 가져간다. `remove`는 멱등이라
        // 재시도가 안전하다.
        totals.failed += ids.length;
        continue;
      }

      totals.removed += completed;
      totals.failed += ids.length - completed;
    }

    console.log("storage cleanup completed", totals);
    return Response.json(totals);
  };
}
