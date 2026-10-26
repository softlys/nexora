-- Click-to-call and incoming call cards: each user's internal number (extension) on the office PBX.

alter table public.profiles add column phone_extension text check (phone_extension ~ '^[0-9]{1,10}$');
grant update (phone_extension) on public.profiles to authenticated;
