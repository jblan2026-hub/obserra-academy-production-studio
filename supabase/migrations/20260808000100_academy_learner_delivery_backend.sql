create extension if not exists pgcrypto;

create table if not exists public.academy_delivery_releases (
  course_id text primary key references public."Course"(id) on delete cascade,
  course_slug text not null unique,
  version text not null,
  status text not null check (status = 'PUBLISHED'),
  manifest jsonb not null,
  content_hash text not null,
  lesson_count integer not null check (lesson_count > 0),
  assessment_count integer not null check (assessment_count >= 0),
  video_count integer not null check (video_count >= 0),
  material_count integer not null check (material_count >= 0),
  certificate_template_available boolean not null default false,
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academy_course_artifacts (
  artifact_id uuid primary key default gen_random_uuid(),
  course_id text not null references public."Course"(id) on delete cascade,
  lesson_id text references public."Lesson"(id) on delete cascade,
  kind text not null check (kind in (
    'video',
    'captions',
    'transcript',
    'learner-guide',
    'workbook',
    'slide-deck',
    'resource',
    'certificate-template'
  )),
  title text not null,
  body text,
  bucket text check (bucket is null or bucket in ('academy-videos', 'academy-materials', 'academy-certificates')),
  storage_key text,
  mime_type text,
  visibility text not null default 'LEARNER' check (visibility in ('LEARNER', 'INSTRUCTOR', 'INTERNAL')),
  downloadable boolean not null default false,
  checksum_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((bucket is null and storage_key is null) or (bucket is not null and storage_key is not null)),
  check (body is not null or storage_key is not null)
);

create unique index if not exists academy_course_artifacts_natural_key
  on public.academy_course_artifacts (
    course_id,
    coalesce(lesson_id, ''),
    kind,
    title
  );

create index if not exists academy_course_artifacts_course_visibility_idx
  on public.academy_course_artifacts (course_id, visibility, kind);

create index if not exists academy_course_artifacts_lesson_idx
  on public.academy_course_artifacts (lesson_id)
  where lesson_id is not null;

alter table public.academy_delivery_releases enable row level security;
alter table public.academy_course_artifacts enable row level security;

revoke all on table public.academy_delivery_releases from anon, authenticated;
revoke all on table public.academy_course_artifacts from anon, authenticated;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      (
        'academy-videos',
        'academy-videos',
        false,
        2147483648,
        array['video/mp4', 'video/webm', 'text/vtt', 'application/x-subrip']::text[]
      ),
      (
        'academy-materials',
        'academy-materials',
        false,
        104857600,
        array[
          'application/pdf',
          'text/markdown',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]::text[]
      ),
      (
        'academy-certificates',
        'academy-certificates',
        false,
        52428800,
        array['application/pdf', 'application/json', 'text/html', 'image/png']::text[]
      )
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;
