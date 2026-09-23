/**
 * Storage 업로드가 요청하는 캐시 수명. 24시간(초)이다.
 *
 * 경로는 불변이지만 HTTP 캐시는 Storage/RLS에 다시 묻지 않는다. 그래서 여기의 24시간은
 * 권한 회수 뒤에도 기기에 남은 이미지를 다시 열 수 있는 최대 기간이다. signed URL 자체는
 * 별도로 1시간만 유효하다.
 *
 * signed URL이 55분 동안 Query cache에서 재사용되므로 같은 화면을 다시 열 때는 일반
 * HTTP 캐시도 계속 이긴다. 그 이후의 이미지 재사용은 Service Worker의 24시간 미디어
 * 캐시가 맡되, 원본처럼 1MiB를 넘는 응답은 보관하지 않는다.
 */
export const STORAGE_UPLOAD_CACHE_CONTROL = "86400";
