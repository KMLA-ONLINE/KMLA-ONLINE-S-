alter table public.profiles
add constraint profiles_pub_id_not_reserved check (
  lower(pub_id) not in (
    'admin',
    'administrator',
    'teacher',
    'staff',
    'moderator',
    'support',
    'system',
    'root',
    'sibal'
  )
);
