import type {
  GroupCategory,
  CommentImageInput,
  PostAttachment,
  PostComment,
  PostFormValues,
  PostIdentity,
  PostReaction,
  PostSaveProgress,
  PreparedCommentImage,
  PreparedPostFile,
  ProfilePostFormValues,
  ReactionSummary,
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
 * 개인 게시물 작성 (기능 명세 §8.4).
 *
 * 그룹 게시물과 같은 초안→업로드→커밋 흐름을 쓴다. 첨부 업로드가 부모 게시물 UUID를 먼저
 * 요구하기 때문이다. 다른 점은 커밋에 제목·카테고리 대신 공개 범위가 들어간다는 것뿐이라
 * 업로드 단계는 `uploadPreparedFiles()`를 그대로 공유한다.
 */
export async function createProfilePost(
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
  session = createCommentImageUploadSession(),
): Promise<PostComment> {
  const imageId =
    image && "file" in image
      ? await uploadCommentImage(postId, image, session)
      : undefined;
  const { data, error } = await getSupabase().rpc("create_post_comment", {
    p_post_id: postId,
    p_body: body,
    p_author_identity: authorIdentity,
    p_parent_comment_id: parentCommentId ?? undefined,
    p_image_id: imageId,
  });
  if (error) throw error;
  const comment = data?.[0];
  if (!comment) throw new Error("댓글을 저장하지 못했습니다.");
  return hydrateCommittedComment(comment);
}

export async function updatePostComment(
  commentId: string,
  body: string,
  postId: string,
  image: CommentImageInput | undefined,
  session = createCommentImageUploadSession(),
): Promise<PostComment> {
  const imageId =
    image && "file" in image
      ? await uploadCommentImage(postId, image, session)
      : image && "image_id" in image
        ? image.image_id
        : undefined;
  const { data, error } = await getSupabase().rpc("update_post_comment", {
    p_comment_id: commentId,
    p_body: body,
    p_image_id: imageId,
    p_remove_image: image === null,
  });
  if (error) throw error;
  const comment = data?.[0];
  if (!comment) throw new Error("댓글을 수정하지 못했습니다.");
  return hydrateCommittedComment(comment);
}

export async function deletePostComment(commentId: string): Promise<void> {
  const { error } = await getSupabase().rpc("delete_post_comment", {
    p_comment_id: commentId,
  });
  if (error) throw error;
}

/**
 * 반응 쓰기 (기능 명세 §10.1, §10.2).
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
