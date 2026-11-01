import type { PostAttachment } from "~/features/posts/model/types";
import {
  asMotionKind,
  type MotionKind,
} from "~/shared/lib/media/motion-policy";
export { POST_ATTACHMENT_LIMIT } from "~/features/posts/model/constants";

/** 업로드 파이프라인이 사진을 webp로 정규화하므로, 이미지인지 아닌지는 이 한 줄로 갈린다. */
const IMAGE_MIME = "image/webp";

/** 다시 인코딩해 올린 동영상·GIF의 종류. 사진과 일반 파일은 `null`이다. */
export function attachmentMotionKind(
  attachment: Pick<PostAttachment, "media_kind">,
): MotionKind | null {
  return asMotionKind(attachment.media_kind);
}

function isVisual(item: PostAttachment): boolean {
  return item.mime_type === IMAGE_MIME || attachmentMotionKind(item) !== null;
}

/** `images`는 격자와 뷰어에 함께 놓이는 사진·동영상·GIF다. */
export function splitPostAttachments(attachments: PostAttachment[]) {
  return {
    images: attachments.filter(isVisual),
    files: attachments.filter((item) => !isVisual(item)),
  };
}

/** signed URL에 `download` 쿼리를 붙인다. Storage는 다른 출처라 `<a download>`가 무시되므로, 서버가 `Content-Disposition: attachment`를 내리게 한다. */
export function toAttachmentDownloadUrl(
  signedUrl: string,
  filename: string,
): string {
  const url = new URL(signedUrl);
  url.searchParams.set("download", filename);
  return url.toString();
}

/** 원본 이름을 노출하지 않고 이미지 UUID로 안정적인 다운로드 이름을 만든다. */
export function imageDownloadName(imageId: string): string {
  return `${imageId}.webp`;
}

/** 격자·뷰어 항목의 다운로드 이름. 이름에 올린 사람의 파일 이름을 드러내지 않는다. */
export function visualDownloadName(attachment: PostAttachment): string {
  return attachmentMotionKind(attachment)
    ? `${attachment.attachment_id}.mp4`
    : imageDownloadName(attachment.attachment_id);
}
