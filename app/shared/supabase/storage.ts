/**
 * Storage 업로드가 요청하는 캐시 수명. 1년(초)이다.
 *
 * 이렇게까지 길게 잡아도 되는 이유는 경로가 불변이기 때문이다. 업로드는 매번 새
 * UUID 경로를 받고 기존 object를 덮어쓰지 않으므로(`upsert: false`), 한 URL이
 * 나중에 다른 내용을 가리키는 일이 없다.
 *
 * 버는 건 대부분 브라우저 캐시다. Smart CDN이 없으면 signed URL은 토큰마다 별개의
 * 캐시 키가 되어 CDN 히트를 기대하기 어렵고, 기본값인 1시간은 같은 URL을 다시 여는
 * 동안에도 이미지를 다시 받아오게 만든다.
 */
export const STORAGE_UPLOAD_CACHE_CONTROL = "31536000";
