/**
 * 이 빌드가 맞춰 만들어진 DB 계약의 버전.
 *
 * 옛 앱이 기대는 RPC·컬럼을 깨는 마이그레이션에서 `public.min_client_version()`과 함께 올린다.
 * 두 값은 같은 커밋에서 항상 같아야 하고, 테스트가 그것을 확인한다. 깨지지 않는 배포에서는
 * 건드리지 않는다 — 올리면 그 배포를 받기 전의 모든 앱이 막힌다.
 */
export const CLIENT_COMPAT_VERSION = 1;
