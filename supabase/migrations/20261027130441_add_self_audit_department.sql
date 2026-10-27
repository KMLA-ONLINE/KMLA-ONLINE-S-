-- 부서 목록은 배포 데이터이므로 seed가 아닌 migration에 추가한다.
-- 가나다순으로 영어상용부(90)와 체육부(100) 사이에 둔다.
INSERT INTO public.profile_departments (name, sort_order, is_active)
VALUES ('자치감사부', 95, true)
ON CONFLICT (name) DO UPDATE SET is_active = true;
