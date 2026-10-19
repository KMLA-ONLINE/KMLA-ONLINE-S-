-- 사용자가 요청한 기존 이름과 정확히 일치하는 비공식 그룹만 바꾼다.
-- 비공식 이름은 중복 가능하므로 한 개로 특정되지 않는 이름은 그대로 둔다.
WITH names (old_name, new_name) AS (
  VALUES ('떨줍', '떨99 줍9'), ('먹사팔', '먹9 사9 팔9'), ('오늘의 혼빵', '오늘 혼정빵은')
), targets AS (
  SELECT (array_agg(g.id))[1] AS id, names.new_name
  FROM public.groups AS g
  JOIN names ON g.name = names.old_name
  WHERE g.kind = 'unofficial'
  GROUP BY names.old_name, names.new_name
  HAVING count(*) = 1
)
UPDATE public.groups AS g SET name = targets.new_name
FROM targets WHERE g.id = targets.id;
