-- public.memories を HCD memory-map パイプラインの出力に合わせて再作成する。
-- 実行: メンバーのSupabaseプロジェクトの SQL Editor で実行する。
-- 前提: 既存 memories の8行はダミーデータ（card_url が bing.com 等）なので破棄してよい。
-- 経緯: 旧テーブルは id=integer / event_id=uuid / era=enum(era_type) / genre=enum(genre_type) で、
--       ワーカー出力（id=text "HCD-..." / event_id=slug / era="1980年代" / genre=slug）と型が不一致だった。

begin;

drop table if exists public.memories cascade;

create table public.memories (
  id                text primary key,        -- record.id  例: HCD-20260613-141847-A9UJ
  event_id          text not null,           -- 例: reitaku-hcd-2026
  status            text not null default 'published'
                       check (status in ('published','hidden')),
  nickname          text,
  memory_text       text,                    -- レビュー後本文のみ（OCR原文は送らない）
  genre             text,                    -- 正規化スラッグ（enumにしない）
  era               text,                    -- 例: 1980年代（enumにしない）
  latitude          double precision,
  longitude         double precision,
  captured_at       timestamptz,
  card_url          text,                    -- R2 publicImageUrl（HEAD検証済み）
  card_key          text,
  content_hash      text,                    -- h<digest>。再送・冪等判定
  card_generated_at timestamptz,
  updated_at        timestamptz not null default now(),
  reitaku_dummy     boolean not null default false  -- 大学内=true / 大学外=false
);

create index memories_event_status_idx on public.memories (event_id, status);
create index memories_captured_at_idx  on public.memories (captured_at desc);

alter table public.memories enable row level security;

-- 公開アプリ(anon / sb_publishable_)は status='published' のみ select 可。
-- 書き込みは service_role / sb_secret_ のみ（RLSバイパス）。
drop policy if exists "public read published" on public.memories;
create policy "public read published" on public.memories
  for select using (status = 'published');

commit;

-- 任意: 旧enum型が他で未使用なら掃除する（使用中ならエラーになるのでその場合はスキップ）。
-- drop type if exists era_type;
-- drop type if exists genre_type;
