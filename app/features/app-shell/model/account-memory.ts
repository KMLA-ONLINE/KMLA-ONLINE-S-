/**
 * 셸이 모듈 수준에 두는 기억(탭별 마지막 주소, 스크롤 위치). 셸 layout은 게이트 밖으로 나가면
 * 언마운트되므로 컴포넌트 상태에 둘 수 없다. 새로고침 없이 다른 계정으로 로그인하면 이전 계정의
 * 대화방·그룹·위치를 쓰면 안 되므로, 주인(셸 프로필 id)이 바뀌면 새로 만든다.
 */
export function createAccountMemory<T>(create: () => T): (owner: number) => T {
  let current: { owner: number; value: T } | null = null;
  return (owner) => {
    if (current?.owner !== owner) current = { owner, value: create() };
    return current.value;
  };
}
