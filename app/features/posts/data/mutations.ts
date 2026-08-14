import type {
  GroupCategory,
  PostAttachment,
  PostComment,
  PostFormValues,
  PostIdentity,
  PostSaveProgress,
  PreparedPostFile,
} from "~/features/posts/model/types";
import { uploadPostAttachment } from "~/features/posts/data/files";
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

export async function createGroupPost(
  groupId: string,
  values: PostFormValues,
  publish = true,
): Promise<string> {
  const { data, error } = await getSupabase().rpc("create_group_post", {
    p_group_id: groupId,
    p_title: values.title,
    p_body: values.body,
    p_category_id: values.categoryId || undefined,
    p_author_identity: values.authorIdentity,
    p_publish: publish,
  });
  if (error) throw error;
  return data;
}

type PreparedAttachmentRow = Awaited<ReturnType<typeof preparePostAttachment>>;

export interface PostUploadSession {
  postId?: string;
  authorIdentity?: PostFormValues["authorIdentity"];
  files: Map<
    string,
    { attachment: PreparedAttachmentRow; uploaded: boolean; finalized: boolean }
  >;
}

export function createPostUploadSession(): PostUploadSession {
  return { files: new Map() };
}

async function commitGroupPost(
  postId: string,
  values: PostFormValues,
  attachmentIds: string[],
  publish: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc("commit_group_post", {
    p_post_id: postId,
    p_title: values.title,
    p_body: values.body,
    p_category_id: values.categoryId || undefined,
    p_attachment_ids: attachmentIds,
    p_publish: publish,
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
  const ids: string[] = [];
  for (const [index, item] of files.entries()) {
    onProgress?.("uploading", index, files.length);
    let state = session.files.get(item.key);
    if (!state) {
      state = {
        attachment: await preparePostAttachment(postId, item),
        uploaded: false,
        finalized: false,
      };
      session.files.set(item.key, state);
    }
    if (!state.uploaded) {
      try {
        await uploadPostAttachment(state.attachment.object_path, item.file);
        state.uploaded = true;
      } catch (uploadError) {
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
    ids.push(state.attachment.id);
  }
  onProgress?.("uploading", files.length, files.length);
  return ids;
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
  if (
    session.postId &&
    session.authorIdentity &&
    session.authorIdentity !== values.authorIdentity
  ) {
    await deleteGroupPost(session.postId);
    session.postId = undefined;
    session.files.clear();
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
  const addedByKey = new Map(
    additions.map((item, index) => [item.key, addedIds[index]]),
  );
  const existingIds = new Set(existing.map((item) => item.attachment_id));
  const orderedIds = order.flatMap((key) => {
    if (existingIds.has(key) && !removedIds.has(key)) return [key];
    const addedId = addedByKey.get(key);
    return addedId ? [addedId] : [];
  });
  onProgress?.("updating", 0, additions.length);
  await commitGroupPost(postId, values, orderedIds, false);
  return postId;
}

export async function reorderPostAttachments(
  postId: string,
  attachmentIds: string[],
): Promise<void> {
  const { error } = await getSupabase().rpc("reorder_post_attachments", {
    p_post_id: postId,
    p_attachment_ids: attachmentIds,
  });
  if (error) throw error;
}

export async function updateGroupPost(
  postId: string,
  values: PostFormValues,
): Promise<string> {
  const { data, error } = await getSupabase().rpc("update_group_post", {
    p_post_id: postId,
    p_title: values.title,
    p_body: values.body,
    p_category_id: values.categoryId || undefined,
  });
  if (error) throw error;
  return data;
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
): Promise<PostComment> {
  const { data, error } = await getSupabase().rpc("create_post_comment", {
    p_post_id: postId,
    p_body: body,
    p_author_identity: authorIdentity,
    p_parent_comment_id: parentCommentId ?? undefined,
  });
  if (error) throw error;
  const comment = data?.[0];
  if (!comment) throw new Error("댓글을 저장하지 못했습니다.");
  return comment;
}

export async function updatePostComment(
  commentId: string,
  body: string,
): Promise<PostComment> {
  const { data, error } = await getSupabase().rpc("update_post_comment", {
    p_comment_id: commentId,
    p_body: body,
  });
  if (error) throw error;
  const comment = data?.[0];
  if (!comment) throw new Error("댓글을 수정하지 못했습니다.");
  return comment;
}

export async function deletePostComment(commentId: string): Promise<void> {
  const { error } = await getSupabase().rpc("delete_post_comment", {
    p_comment_id: commentId,
  });
  if (error) throw error;
}
