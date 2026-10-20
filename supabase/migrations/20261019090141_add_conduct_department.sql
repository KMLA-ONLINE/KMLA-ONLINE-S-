-- 부서 목록은 배포 데이터이므로 seed가 아닌 migration에 추가한다.
INSERT INTO public.profile_departments (name, sort_order, is_active)
VALUES ('선도부', 75, true)
ON CONFLICT (name) DO UPDATE SET is_active = true;
