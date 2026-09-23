-- Staff posts keep their immutable author in private.post_authors. Expose that
-- author's ordinary accepted profile for presentation while anonymous posts
-- continue to return no profile fields.
do $$
declare
  function_oid regprocedure;
  function_definition text;
begin
  foreach function_oid in array array[
    'public.list_group_posts(uuid,uuid,timestamp with time zone,uuid,integer)'::regprocedure,
    'public.get_group_post(uuid)'::regprocedure,
    'public.search_group_posts(uuid,text,integer)'::regprocedure
  ]
  loop
    function_definition := pg_get_functiondef(function_oid);
    function_definition := replace(
      function_definition,
      'case when post.author_identity = ''identified'' then profile.pub_id end',
      'case when post.author_identity in (''identified'', ''staff'') then profile.pub_id end'
    );
    function_definition := replace(
      function_definition,
      'case when post.author_identity = ''identified'' then profile.name end',
      'case when post.author_identity in (''identified'', ''staff'') then profile.name end'
    );
    function_definition := replace(
      function_definition,
      'case when post.author_identity = ''identified'' then profile.avatar_path end',
      'case when post.author_identity in (''identified'', ''staff'') then profile.avatar_path end'
    );
    function_definition := replace(
      function_definition,
      'on post.author_identity = ''identified''
    and profile.id = post.display_author_profile_id',
      'on (
      (post.author_identity = ''identified'' and profile.id = post.display_author_profile_id)
      or (post.author_identity = ''staff'' and profile.id = author.profile_id)
    )'
    );
    execute function_definition;
  end loop;
end;
$$;
