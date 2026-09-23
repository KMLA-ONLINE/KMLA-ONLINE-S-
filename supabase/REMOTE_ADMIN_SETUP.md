# 원격 프로젝트 최초 관리자 만들기

원격 프로젝트를 새로 만든 뒤 앱 관리자가 한 명도 없을 때만 사용하는 일회성 절차다.
관리자 이메일이나 비밀번호를 seed 또는 저장소에 커밋하지 않는다.

## 1. Auth 사용자 생성

1. Supabase Dashboard에서 대상 프로젝트를 연다.
2. **Authentication > Users**로 이동한다.
3. **Add user > Create new user**를 선택한다.
4. 실제로 관리할 이메일과 비밀번호를 입력하고 사용자를 생성한다.
5. 생성한 사용자의 이메일이 확인된 상태인지 확인한다.

비밀번호는 비밀번호 관리자로 생성하고 보관한다. 이 문서나 SQL Editor의 저장된 snippet에
비밀번호를 입력하지 않는다.

## 2. 앱 관리자 프로필 생성

Dashboard의 **SQL Editor**에서 아래 SQL의 값을 실제 정보로 바꾼 뒤 한 번만 실행한다.
`admin-email@example.com`은 1단계에서 만든 Auth 사용자의 이메일과 정확히 같아야 한다.

```sql
do $$
declare
  target_user_id uuid;
begin
  select id into target_user_id
  from auth.users
  where lower(email) = lower('admin-email@example.com');

  if target_user_id is null then
    raise exception 'Auth user not found';
  end if;

  if exists (
    select 1 from public.profiles where auth_user_id = target_user_id
  ) then
    raise exception 'A profile already exists for this Auth user';
  end if;

  insert into public.profiles (
    auth_user_id,
    pub_id,
    name,
    role,
    type,
    cohort,
    gender,
    academic_track,
    status
  ) values (
    target_user_id,
    'first-admin',
    '관리자 이름',
    'admin',
    'alumni',
    1,
    'male',
    'domestic',
    'accepted'
  );
end
$$;
```

- `pub_id`: 5~15자의 영문 소문자, 숫자, 하이픈 조합
- `name`: 실제 표시 이름
- `cohort`: 실제 기수
- `gender`: `male` 또는 `female`
- `academic_track`: `domestic` 또는 `international`

## 3. 확인 및 정리

1. 생성한 계정으로 앱에 로그인한다.
2. 메뉴에 관리자 허브가 표시되는지 확인한다.
3. 관리자 허브에서 두 번째 관리자를 임명한다.
4. SQL Editor의 실행 기록이나 저장된 snippet에 이메일 등 불필요한 개인정보가 남아 있으면 제거한다.

최초 관리자가 만들어진 뒤에는 이 SQL을 다시 사용하지 않는다. 이후 관리자 임명과 강등은 앱의
관리자 허브를 사용한다.
