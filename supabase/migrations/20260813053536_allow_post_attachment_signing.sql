drop policy "post_attachments_storage_select_reader" on storage.objects;

create policy "post_attachments_storage_select_reader"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'post-attachments'
  and storage.allow_any_operation(array[
    'object.get_authenticated_info',
    'object.get_authenticated',
    'object.sign',
    'object.sign_many'
  ])
  and exists (
    select 1
    from public.post_attachments as attachment
    join public.posts as post on post.id = attachment.post_id
    where attachment.storage_bucket = storage.objects.bucket_id
      and attachment.object_path = storage.objects.name
      and attachment.status = 'ready'
      and post.deleted_at is null
      and (
        (post.published_at is not null and private.is_group_member(post.group_id))
        or (post.published_at is null and private.is_post_author(post.id))
      )
  )
);
