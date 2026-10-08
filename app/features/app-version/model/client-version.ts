/**
 * 이 빌드가 맞춰 만들어진 DB 계약의 버전.
 *
 * 손으로 고치지 않는다. 배포된 앱이 쓰는 DB 계약이 깨지면 `npm run check:compat`이 실패하고,
 * `npm run client-compat:bump`가 이 값과 `public.min_client_version()`을 함께 올린다. 올리면
 * 그 배포를 받기 전의 앱은 업데이트할 때까지 막힌다.
 */
export const CLIENT_COMPAT_VERSION = 1;
