import {
  normalizeMentions,
  withMentions,
  type MentionDraftEntry,
} from "~/features/posts/model/mentions";
import type {
  GroupCategory,
  CommentImageInput,
  PostAttachment,
  PostComment,
  PostFormValues,
  PostIdentity,
  PostFileUploadState,
  PostReaction,
  PostSaveProgress,
  PreparedCommentImage,
  PreparedPostFile,
  ProfilePostFormValues,
  ReactionSummary,
  AnonymousActivitySourceKind,
} from "~/features/posts/model/types";
import { uploadPostAttachment } from "~/features/posts/data/files";
import { hydratePostComments } from "~/features/posts/data/queries";
import { getSupabase } from "~/shared/supabase/client";

export async function createGroupCategory(
  groupId: string,
  name: string,
  position?: number,
): Promise<GroupCategory> {
  const { data, error } = await getSupabase().rpc("create_group_category", {
    p_group_id: groupId,
    p_name: name,
    p_position: position,
  });
  if (error) throw error;
  return data;
}

export async function updateGroupCategory(
  categoryId: string,
  name: string,
  position: number,
): Promise<GroupCategory> {
  const { data, error } = await getSupabase().rpc("update_group_category", {
    p_category_id: categoryId,
    p_name: name,
    p_position: position,
  });
  if (error) throw error;
  return data;
}

export async function moveGroupCategory(
  categoryId: string,
  direction: -1 | 1,
): Promise<GroupCategory[]> {
  const { data, error } = await getSupabase().rpc("move_group_category", {
    p_category_id: categoryId,
    p_direction: direction,
  });
  if (error) throw error;
  return data;
}

export async function deleteGroupCategory(categoryId: string): Promise<void> {
  const { error } = await getSupabase().rpc("delete_group_category", {
    p_category_id: categoryId,
  });
  if (error) throw error;
}

export async function restrictGroupAnonymousActivity(
  sourceKind: AnonymousActivitySourceKind,
  sourceId: string,
  reason: string,
  durationDays: number,
) {
  const { data, error } = await getSupabase().rpc(
    "restrict_group_anonymous_activity",
    {
      p_source_kind: sourceKind,
      p_source_id: sourceId,
      p_reason: reason,
      p_duration_days: durationDays,
    },
  );
  if (error) throw error;
  const restriction = data?.[0];
  if (!restriction) throw new Error("익명 활동을 차단하지 못했습니다.");
  return restriction;
}

export async function cancelGroupAnonymousActivityRestriction(
  sourceKind: AnonymousActivitySourceKind,
  sourceId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc(
    "cancel_group_anonymous_activity_restriction",
    { p_source_kind: sourceKind, p_source_id: sourceId },
  );
  if (error) throw error;
}

async function createGroupPost(
  groupId: string,
  values: PostFormValues,
  publish = true,
): Promise<string> {
  const mentions = normalizeMentions(values.body, values.mentions);
  const { data, error } = await getSupabase().rpc("create_group_post", {
    p_group_id: groupId,
    p_title: values.title,
    p_body: mentions.body,
    p_category_id: values.categoryId || undefined,
    p_author_identity: values.authorIdentity,
    p_publish: publish,
    p_mention_pub_ids: mentions.pubIds,
  });
  if (error) throw error;
  return data;
}

type PreparedAttachmentRow = Awaited<ReturnType<typeof preparePostAttachment>>;

interface PostUploadFileState extends PostFileUploadState {
  attachment?: PreparedAttachmentRow;
  uploaded: boolean;
  finalized: boolean;
  promise?: Promise<string>;
  removed?: boolean;
}

type PostUploadListener = (
  key: string,
  state: PostFileUploadState | undefined,
) => void;

interface QueuedUpload {
  key: string;
  run: () => Promise<string>;
  resolve: (id: string) => void;
  reject: (error: unknown) => void;
}

export interface PostUploadSession {
  postId?: string;
  postPromise?: Promise<string>;
  authorIdentity?: PostFormValues["authorIdentity"];
  files: Map<string, PostUploadFileState>;
  listeners: Set<PostUploadListener>;
  queue: QueuedUpload[];
  activeUploads: number;
  cancelled: boolean;
  controllers: Map<string, AbortController>;
}

export function createPostUploadSession(): PostUploadSession {
  return {
    files: new Map(),
    listeners: new Set(),
    queue: [],
    activeUploads: 0,
    cancelled: false,
    controllers: new Map(),
  };
}

export function subscribePostUploadSession(
  session: PostUploadSession,
  listener: PostUploadListener,
): () => void {
  session.listeners.add(listener);
  session.files.forEach((state, key) => listener(key, state));
  return () => session.listeners.delete(listener);
}

function notifyPostUpload(
  session: PostUploadSession,
  key: string,
  state: PostUploadFileState | undefined,
) {
  session.listeners.forEach((listener) => listener(key, state));
}

function updatePostUpload(
  session: PostUploadSession,
  key: string,
  patch: Partial<PostUploadFileState>,
) {
  const state = session.files.get(key);
  if (!state) return;
  Object.assign(state, patch);
  notifyPostUpload(session, key, { ...state });
}

function registerPostFiles(
  files: PreparedPostFile[],
  session: PostUploadSession,
) {
  files.forEach((item) => {
    if (session.files.has(item.key)) return;
    const state: PostUploadFileState = {
      status: "queued",
      progress: 0,
      uploaded: false,
      finalized: false,
    };
    session.files.set(item.key, state);
    notifyPostUpload(session, item.key, { ...state });
  });
}

function drainPostUploadQueue(session: PostUploadSession) {
  if (session.cancelled) {
    const error = new DOMException("Upload aborted", "AbortError");
    session.queue.splice(0).forEach((task) => task.reject(error));
    return;
  }
  while (session.activeUploads < 3 && session.queue.length > 0) {
    const task = session.queue.shift()!;
    session.activeUploads += 1;
    void task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        session.activeUploads -= 1;
        drainPostUploadQueue(session);
      });
  }
}

function enqueuePostUpload(
  key: string,
  session: PostUploadSession,
  run: () => Promise<string>,
): Promise<string> {
  const promise = new Promise<string>((resolve, reject) => {
    session.queue.push({ key, run, resolve, reject });
  });
  drainPostUploadQueue(session);
  return promise;
}

type PreparedCommentImageRow = Awaited<
  ReturnType<typeof prepareCommentImageUpload>
>;

export interface CommentImageUploadSession {
  files: Map<
    string,
    {
      image: PreparedCommentImageRow;
      uploaded: boolean;
      finalized: boolean;
    }
  >;
}

export function createCommentImageUploadSession(): CommentImageUploadSession {
  return { files: new Map() };
}

async function prepareCommentImageUpload(
  postId: string,
  item: PreparedCommentImage,
) {
  const { data, error } = await getSupabase().rpc("prepare_comment_image", {
    p_post_id: postId,
    p_mime_type: item.file.type,
    p_size_bytes: item.file.size,
    p_width: item.width,
    p_height: item.height,
  });
  if (error) throw error;
  return data;
}

async function uploadCommentImage(
  postId: string,
  item: PreparedCommentImage,
  session: CommentImageUploadSession,
): Promise<string> {
  let state = session.files.get(item.key);
  if (!state) {
    state = {
      image: await prepareCommentImageUpload(postId, item),
      uploaded: false,
      finalized: false,
    };
    session.files.set(item.key, state);
  }
  if (!state.uploaded) {
    try {
      await uploadPostAttachment(state.image.object_path, item.file);
      state.uploaded = true;
    } catch (uploadError) {
      // 첨부와 같은 이유로 finalize를 한 번 더 믿는다 — `finalize_comment_image`도
      // storage.objects를 대조하므로, 통과했다면 응답만 잃었던 것이다.
      try {
        const { error } = await getSupabase().rpc("finalize_comment_image", {
          p_image_id: state.image.id,
        });
        if (error) throw error;
        state.uploaded = true;
        state.finalized = true;
      } catch {
        throw uploadError;
      }
    }
  }
  if (!state.finalized) {
    const { error } = await getSupabase().rpc("finalize_comment_image", {
      p_image_id: state.image.id,
    });
    if (error) throw error;
    state.finalized = true;
  }
  return state.image.id;
}

async function hydrateCommittedComment(
  comment: Omit<PostComment, "images">,
): Promise<PostComment> {
  try {
    return (await hydratePostComments([comment]))[0];
  } catch {
    // The database commit already succeeded. Treat a follow-up metadata/signing
    // failure as a temporary missing preview rather than inviting a duplicate retry.
    return { ...comment, images: [] };
  }
}

async function commitGroupPost(
  postId: string,
  values: PostFormValues,
  attachmentIds: string[],
  publish: boolean,
): Promise<void> {
  // 편집기가 매긴 번호를 본문에 남은 토큰 기준으로 다시 매긴다. 서버는 ordinal 을 배열 첨자로
  // 쓰고 1~50 만 받으므로, 넣었다 지우기를 반복한 본문을 그대로 보내면 상한에 걸린다.
  const mentions = normalizeMentions(values.body, values.mentions);
  const { error } = await getSupabase().rpc("commit_group_post", {
    p_post_id: postId,
    p_title: values.title,
    p_body: mentions.body,
    p_category_id: values.categoryId || undefined,
    p_attachment_ids: attachmentIds,
    p_publish: publish,
    p_mention_pub_ids: mentions.pubIds,
  });
  if (error) throw error;
}

async function preparePostAttachment(postId: string, item: PreparedPostFile) {
  const { data, error } = await getSupabase().rpc("prepare_post_attachment", {
    p_post_id: postId,
    p_original_filename: item.file.name,
    p_mime_type: item.file.type || "application/octet-stream",
    p_size_bytes: item.file.size,
    p_width: item.width ?? undefined,
    p_height: item.height ?? undefined,
  });
  if (error) throw error;
  return data;
}

async function finalizePostAttachment(attachmentId: string): Promise<void> {
  const { error } = await getSupabase().rpc("finalize_post_attachment", {
    p_attachment_id: attachmentId,
  });
  if (error) throw error;
}

async function deletePreparedPostAttachment(
  attachmentId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("delete_post_attachment", {
    p_attachment_id: attachmentId,
  });
  if (error) throw error;
}

async function runPostFileUpload(
  postId: string,
  item: PreparedPostFile,
  session: PostUploadSession,
): Promise<string> {
  const state = session.files.get(item.key)!;
  const controller = new AbortController();
  session.controllers.set(item.key, controller);
  try {
    if (session.cancelled || state.removed)
      throw new DOMException("Upload aborted", "AbortError");
    if (!state.attachment) {
      updatePostUpload(session, item.key, {
        status: "uploading",
        progress: 0,
        error: undefined,
      });
      state.attachment = await preparePostAttachment(postId, item);
    }
    if (!state.uploaded) {
      try {
        await uploadPostAttachment(
          state.attachment.object_path,
          item.file,
          (progress) =>
            updatePostUpload(session, item.key, {
              status: "uploading",
              progress,
            }),
          controller.signal,
        );
        // 축소본은 finalize보다 먼저 올라가야 한다 — `finalize_post_attachment`가 object의
        // 존재를 확인하고, 없으면 `thumbnail_path`를 지워 원본으로 떨어뜨리기 때문이다.
        // 진행률은 원본이 이미 100%를 찍었으므로 건드리지 않는다. 실패해도 삼킨다.
        if (state.attachment.thumbnail_path && item.thumbnail) {
          await uploadPostAttachment(
            state.attachment.thumbnail_path,
            item.thumbnail,
            undefined,
            controller.signal,
          ).catch(() => undefined);
        }
        state.uploaded = true;
      } catch (uploadError) {
        // 업로드가 실패로 보여도 finalize가 통과하면 object는 실제로 올라간 것이다 —
        // `finalize_post_attachment`가 storage.objects에서 소유자·크기·MIME까지 대조하기
        // 때문이다. 응답만 잃은 경우(타임아웃, 연결 끊김)를 여기서 건져 낸다. object가
        // 없으면 finalize가 P0002로 던지므로, 원래의 업로드 오류를 그대로 올린다.
        try {
          await finalizePostAttachment(state.attachment.id);
          state.uploaded = true;
          state.finalized = true;
        } catch {
          throw uploadError;
        }
      }
    }
    if (!state.finalized) {
      await finalizePostAttachment(state.attachment.id);
      state.finalized = true;
    }
    if (state.removed) {
      await deletePreparedPostAttachment(state.attachment.id);
      state.attachment = undefined;
      throw new Error("removed");
    }
    updatePostUpload(session, item.key, { status: "ready", progress: 1 });
    return state.attachment.id;
  } catch (error) {
    if (!state.removed) {
      updatePostUpload(session, item.key, {
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "파일을 업로드하지 못했습니다.",
      });
    }
    throw error;
  } finally {
    session.controllers.delete(item.key);
  }
}

function ensurePostFileUpload(
  postId: string,
  item: PreparedPostFile,
  session: PostUploadSession,
): Promise<string> {
  if (session.cancelled)
    return Promise.reject(new DOMException("Upload aborted", "AbortError"));
  let state = session.files.get(item.key);
  if (!state) {
    state = {
      status: "queued",
      progress: 0,
      uploaded: false,
      finalized: false,
    };
    session.files.set(item.key, state);
    notifyPostUpload(session, item.key, { ...state });
  }
  if (state.status === "ready" && state.attachment) {
    return Promise.resolve(state.attachment.id);
  }
  if (state.promise) return state.promise;
  state.removed = false;
  state.error = undefined;
  state.promise = enqueuePostUpload(item.key, session, () =>
    runPostFileUpload(postId, item, session),
  ).finally(() => {
    const current = session.files.get(item.key);
    if (current) current.promise = undefined;
  });
  return state.promise;
}

async function ensureGroupUploadDraft(
  groupId: string,
  identity: PostIdentity,
  session: PostUploadSession,
): Promise<string> {
  if (session.postId) return session.postId;
  session.postPromise ??= (async () => {
    const { data, error } = await getSupabase().rpc(
      "create_group_post_upload_draft",
      { p_group_id: groupId, p_author_identity: identity },
    );
    if (error) throw error;
    session.postId = data;
    session.authorIdentity = identity;
    return data;
  })().finally(() => {
    session.postPromise = undefined;
  });
  return session.postPromise;
}

async function ensureProfileUploadDraft(
  timelinePubId: string,
  visibility: ProfilePostFormValues["visibility"],
  session: PostUploadSession,
): Promise<string> {
  if (session.postId) return session.postId;
  session.postPromise ??= createProfilePost(timelinePubId, visibility)
    .then((postId) => {
      session.postId = postId;
      return postId;
    })
    .finally(() => {
      session.postPromise = undefined;
    });
  return session.postPromise;
}

export async function preuploadGroupPostFiles(
  groupId: string,
  identity: PostIdentity,
  files: PreparedPostFile[],
  session: PostUploadSession,
): Promise<void> {
  registerPostFiles(files, session);
  try {
    const postId = await ensureGroupUploadDraft(groupId, identity, session);
    await Promise.all(
      files.map((item) => ensurePostFileUpload(postId, item, session)),
    );
  } catch (error) {
    files.forEach((item) => {
      const state = session.files.get(item.key);
      if (state?.status === "queued")
        updatePostUpload(session, item.key, {
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "업로드를 시작하지 못했습니다.",
        });
    });
    throw error;
  }
}

export async function preuploadProfilePostFiles(
  timelinePubId: string,
  visibility: ProfilePostFormValues["visibility"],
  files: PreparedPostFile[],
  session: PostUploadSession,
): Promise<void> {
  registerPostFiles(files, session);
  try {
    const postId = await ensureProfileUploadDraft(
      timelinePubId,
      visibility,
      session,
    );
    await Promise.all(
      files.map((item) => ensurePostFileUpload(postId, item, session)),
    );
  } catch (error) {
    files.forEach((item) => {
      const state = session.files.get(item.key);
      if (state?.status === "queued")
        updatePostUpload(session, item.key, {
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "업로드를 시작하지 못했습니다.",
        });
    });
    throw error;
  }
}

export async function preuploadPostFiles(
  postId: string,
  files: PreparedPostFile[],
  session: PostUploadSession,
): Promise<void> {
  session.postId = postId;
  registerPostFiles(files, session);
  await Promise.all(
    files.map((item) => ensurePostFileUpload(postId, item, session)),
  );
}

export async function discardPostFileUpload(
  key: string,
  session: PostUploadSession,
): Promise<void> {
  const state = session.files.get(key);
  if (!state) return;
  state.removed = true;
  session.controllers.get(key)?.abort();
  const queuedIndex = session.queue.findIndex((task) => task.key === key);
  if (queuedIndex >= 0) {
    const [task] = session.queue.splice(queuedIndex, 1);
    task.reject(new DOMException("Upload aborted", "AbortError"));
  }
  if (state.promise) {
    try {
      await state.promise;
    } catch {
      // Failed and removed uploads have no live attachment to keep in the editor.
    }
  }
  if (state.attachment) {
    await deletePreparedPostAttachment(state.attachment.id);
  }
  session.files.delete(key);
  notifyPostUpload(session, key, undefined);
}

export async function discardPostUploadDraft(
  kind: "group" | "profile",
  session: PostUploadSession,
): Promise<void> {
  cancelPostUploads(session);
  if (session.postPromise) {
    try {
      await session.postPromise;
    } catch {
      return;
    }
  }
  if (!session.postId) return;
  if (kind === "group") await deleteGroupPost(session.postId);
  else await deleteProfilePost(session.postId);
  session.postId = undefined;
  session.files.clear();
}

export async function discardPostUploads(
  session: PostUploadSession,
): Promise<void> {
  cancelPostUploads(session);
  await Promise.allSettled(
    [...session.files.values()].flatMap((state) =>
      state.promise ? [state.promise] : [],
    ),
  );
  await Promise.allSettled(
    [...session.files.values()].flatMap((state) =>
      state.attachment
        ? [deletePreparedPostAttachment(state.attachment.id)]
        : [],
    ),
  );
}

function cancelPostUploads(session: PostUploadSession) {
  session.cancelled = true;
  session.files.forEach((state) => {
    state.removed = true;
  });
  session.controllers.forEach((controller) => controller.abort());
  drainPostUploadQueue(session);
}

async function uploadPreparedFiles(
  postId: string,
  files: PreparedPostFile[],
  session: PostUploadSession,
  onProgress?: (
    progress: PostSaveProgress,
    completed: number,
    total: number,
  ) => void,
): Promise<string[]> {
  onProgress?.("uploading", 0, files.length);
  const ids = await Promise.all(
    files.map((item) => ensurePostFileUpload(postId, item, session)),
  );
  onProgress?.("uploading", files.length, files.length);
  return ids;
}

/**
 * 화면이 들고 있던 표시 순서를 커밋이 받는 첨부 ID 배열로 옮긴다.
 *
 * 화면의 순서 배열은 기존 첨부의 ID와 아직 업로드되지 않은 새 파일의 로컬 key가 섞여 있다.
 * 업로드가 끝나야 새 파일의 ID가 정해지므로 이 변환은 업로드 뒤에만 할 수 있다.
 */
function resolveAttachmentOrder(
  order: string[],
  existing: PostAttachment[],
  removedIds: Set<string>,
  additions: PreparedPostFile[],
  addedIds: string[],
): string[] {
  const addedByKey = new Map(
    additions.map((item, index) => [item.key, addedIds[index]]),
  );
  const existingIds = new Set(existing.map((item) => item.attachment_id));
  return order.flatMap((key) => {
    if (existingIds.has(key) && !removedIds.has(key)) return [key];
    const addedId = addedByKey.get(key);
    return addedId ? [addedId] : [];
  });
}

export async function createGroupPostWithAttachments(
  groupId: string,
  values: PostFormValues,
  files: PreparedPostFile[],
  session: PostUploadSession,
  onProgress?: (
    progress: PostSaveProgress,
    completed: number,
    total: number,
  ) => void,
): Promise<string> {
  onProgress?.("creating", 0, files.length);
  if (session.postPromise) await session.postPromise;
  if (session.postId && session.authorIdentity !== values.authorIdentity) {
    const { error } = await getSupabase().rpc(
      "update_group_post_draft_identity",
      {
        p_post_id: session.postId,
        p_author_identity: values.authorIdentity,
      },
    );
    if (error) throw error;
    session.authorIdentity = values.authorIdentity;
  }
  const postId =
    session.postId ?? (await createGroupPost(groupId, values, false));
  session.postId = postId;
  session.authorIdentity = values.authorIdentity;
  const ids = await uploadPreparedFiles(postId, files, session, onProgress);
  onProgress?.("publishing", files.length, files.length);
  await commitGroupPost(postId, values, ids, true);
  return postId;
}

export async function updateGroupPostWithAttachments(
  postId: string,
  values: PostFormValues,
  existing: PostAttachment[],
  removedIds: Set<string>,
  additions: PreparedPostFile[],
  order: string[],
  session: PostUploadSession,
  onProgress?: (
    progress: PostSaveProgress,
    completed: number,
    total: number,
  ) => void,
): Promise<string> {
  session.postId = postId;
  const addedIds = await uploadPreparedFiles(
    postId,
    additions,
    session,
    onProgress,
  );
  const orderedIds = resolveAttachmentOrder(
    order,
    existing,
    removedIds,
    additions,
    addedIds,
  );
  onProgress?.("updating", 0, additions.length);
  await commitGroupPost(postId, values, orderedIds, false);
  return postId;
}

/**
 * 개인 게시물 작성.
 *
 * 그룹 게시물과 같은 초안→업로드→커밋 흐름을 쓴다. 첨부 업로드가 부모 게시물 UUID를 먼저
 * 요구하기 때문이다. 다른 점은 커밋에 제목·카테고리 대신 공개 범위가 들어간다는 것뿐이라
 * 업로드 단계는 `uploadPreparedFiles()`를 그대로 공유한다.
 */
async function createProfilePost(
  timelinePubId: string,
  visibility: ProfilePostFormValues["visibility"],
): Promise<string> {
  const { data, error } = await getSupabase().rpc("create_profile_post", {
    p_timeline_pub_id: timelinePubId,
    p_visibility: visibility,
  });
  if (error) throw error;
  return data;
}

async function commitProfilePost(
  postId: string,
  values: ProfilePostFormValues,
  attachmentIds: string[],
  publish: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc("commit_profile_post", {
    p_post_id: postId,
    p_body: values.body,
    p_attachment_ids: attachmentIds,
    p_publish: publish,
    p_visibility: values.visibility,
  });
  if (error) throw error;
}

export async function createProfilePostWithAttachments(
  timelinePubId: string,
  values: ProfilePostFormValues,
  files: PreparedPostFile[],
  session: PostUploadSession,
  onProgress?: (
    progress: PostSaveProgress,
    completed: number,
    total: number,
  ) => void,
): Promise<string> {
  onProgress?.("creating", 0, files.length);
  if (session.postPromise) await session.postPromise;
  const postId =
    session.postId ??
    (await createProfilePost(timelinePubId, values.visibility));
  session.postId = postId;
  const ids = await uploadPreparedFiles(postId, files, session, onProgress);
  onProgress?.("publishing", files.length, files.length);
  await commitProfilePost(postId, values, ids, true);
  return postId;
}

export async function updateProfilePostWithAttachments(
  postId: string,
  values: ProfilePostFormValues,
  existing: PostAttachment[],
  removedIds: Set<string>,
  additions: PreparedPostFile[],
  order: string[],
  session: PostUploadSession,
  onProgress?: (
    progress: PostSaveProgress,
    completed: number,
    total: number,
  ) => void,
): Promise<string> {
  session.postId = postId;
  const addedIds = await uploadPreparedFiles(
    postId,
    additions,
    session,
    onProgress,
  );
  const orderedIds = resolveAttachmentOrder(
    order,
    existing,
    removedIds,
    additions,
    addedIds,
  );
  onProgress?.("updating", 0, additions.length);
  await commitProfilePost(postId, values, orderedIds, false);
  return postId;
}

export async function deleteProfilePost(postId: string): Promise<void> {
  const { error } = await getSupabase().rpc("delete_profile_post", {
    p_post_id: postId,
  });
  if (error) throw error;
}

export async function deleteGroupPost(postId: string): Promise<void> {
  const { error } = await getSupabase().rpc("delete_group_post", {
    p_post_id: postId,
  });
  if (error) throw error;
}

export async function setGroupPostPinned(
  postId: string,
  pinned: boolean,
): Promise<string> {
  const { data, error } = await getSupabase().rpc("set_group_post_pinned", {
    p_post_id: postId,
    p_pinned: pinned,
  });
  if (error) throw error;
  return data;
}

/**
 * 댓글 작성.
 *
 * 세 뮤테이션 모두 RPC가 정본 행을 돌려준다. route를 재검증하는 대신 이 행을 목록에 병합하는
 * 이유는 재검증이 펼쳐 둔 답글 묶음과 불러온 이전 페이지까지 되돌리기 때문이다.
 */
export async function createPostComment(
  postId: string,
  body: string,
  authorIdentity: PostIdentity,
  parentCommentId?: string | null,
  image?: CommentImageInput,
  mentionEntries: MentionDraftEntry[] = [],
  session = createCommentImageUploadSession(),
): Promise<PostComment> {
  const imageId =
    image && "file" in image
      ? await uploadCommentImage(postId, image, session)
      : undefined;
  const mentions = normalizeMentions(body, mentionEntries);
  const { data, error } = await getSupabase().rpc("create_post_comment", {
    p_post_id: postId,
    p_body: mentions.body,
    p_author_identity: authorIdentity,
    p_parent_comment_id: parentCommentId ?? undefined,
    p_image_id: imageId,
    p_mention_pub_ids: mentions.pubIds,
  });
  if (error) throw error;
  const comment = data?.[0];
  if (!comment) throw new Error("댓글을 저장하지 못했습니다.");
  return hydrateCommittedComment(withMentions(comment));
}

export async function updatePostComment(
  commentId: string,
  body: string,
  postId: string,
  image: CommentImageInput | undefined,
  mentionEntries: MentionDraftEntry[] = [],
  session = createCommentImageUploadSession(),
): Promise<PostComment> {
  const imageId =
    image && "file" in image
      ? await uploadCommentImage(postId, image, session)
      : image && "image_id" in image
        ? image.image_id
        : undefined;
  const mentions = normalizeMentions(body, mentionEntries);
  const { data, error } = await getSupabase().rpc("update_post_comment", {
    p_comment_id: commentId,
    p_body: mentions.body,
    p_image_id: imageId,
    p_remove_image: image === null,
    p_mention_pub_ids: mentions.pubIds,
  });
  if (error) throw error;
  const comment = data?.[0];
  if (!comment) throw new Error("댓글을 수정하지 못했습니다.");
  return hydrateCommittedComment(withMentions(comment));
}

export async function deletePostComment(commentId: string): Promise<void> {
  const { error } = await getSupabase().rpc("delete_post_comment", {
    p_comment_id: commentId,
  });
  if (error) throw error;
}

/**
 * 반응 쓰기.
 *
 * 넷 다 갱신된 요약을 그대로 돌려준다. 화면은 누르는 즉시 로컬 계산으로 앞서 나가고, 응답이
 * 오면 이 정본으로 덮어쓴다 — 상위 반응 순위는 남들의 반응까지 봐야 알 수 있어서 클라이언트가
 * 혼자 맞힐 수 없다.
 *
 * 실명이냐 익명이냐는 그룹 정책이 정하므로 인자로 받지 않는다.
 */
export async function setPostReaction(
  postId: string,
  reaction: PostReaction,
): Promise<ReactionSummary> {
  const { data, error } = await getSupabase().rpc("set_post_reaction", {
    p_post_id: postId,
    p_reaction: reaction,
  });
  if (error) throw error;
  return readSummary(data);
}

export async function clearPostReaction(
  postId: string,
): Promise<ReactionSummary> {
  const { data, error } = await getSupabase().rpc("clear_post_reaction", {
    p_post_id: postId,
  });
  if (error) throw error;
  return readSummary(data);
}

export async function setCommentReaction(
  commentId: string,
  reaction: PostReaction,
): Promise<ReactionSummary> {
  const { data, error } = await getSupabase().rpc("set_comment_reaction", {
    p_comment_id: commentId,
    p_reaction: reaction,
  });
  if (error) throw error;
  return readSummary(data);
}

export async function clearCommentReaction(
  commentId: string,
): Promise<ReactionSummary> {
  const { data, error } = await getSupabase().rpc("clear_comment_reaction", {
    p_comment_id: commentId,
  });
  if (error) throw error;
  return readSummary(data);
}

function readSummary(rows: ReactionSummary[] | null): ReactionSummary {
  const summary = rows?.[0];
  if (!summary) throw new Error("반응을 저장하지 못했습니다.");
  return summary;
}
