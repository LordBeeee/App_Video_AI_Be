-- =============================================================================
-- SEED DỮ LIỆU DEMO CHO TRANG "CHI TIÊU AI" (/users/expense-overview)
-- =============================================================================
-- Mục đích : đổ dữ liệu giả để xem trang chi phí (admin) hoạt động như thế nào.
-- Chỉ dùng cho môi trường DEV / DEMO. KHÔNG chạy trên production.
--
-- Cách chạy (sau khi đã `npm run db:setup`):
--   psql "$DATABASE_URL" -f database/seeds/0002_expense_demo.sql
--   hoặc: psql -h localhost -U <user> -d <db> -f 0002_seed_expense_demo.sql
--
-- Đặc điểm:
--   * Chạy lại nhiều lần được (idempotent): xoá dữ liệu seed cũ rồi tạo lại.
--     Chỉ đụng tới user có email đuôi @seed.local, không động vào dữ liệu thật.
--   * Thời gian tính tương đối so với now() => bất kể chạy hôm nào, các bộ lọc
--     7 / 30 / 90 ngày / 12 tháng đều có dữ liệu (dữ liệu trải 150 ngày gần nhất).
--   * Mật khẩu của 12 nhân viên demo: Employee@123
--   * Số liệu ngẫu nhiên (random) nên mỗi lần chạy sẽ lệch nhẹ, nhưng "tính cách"
--     từng nhân viên (xem bảng profile bên dưới) luôn giữ nguyên.
--   * Tên model là dữ liệu minh hoạ, không cần tồn tại trong bảng ai_models.
--
-- Các tình huống được cố ý tạo ra để thử giao diện:
--   - Người dùng nặng video / chat / ảnh / giọng nói  -> biểu đồ tròn, xếp hạng
--   - Người tỷ lệ lỗi cao, người lặp prompt nhiều     -> điểm hiệu quả, bong bóng
--   - Người dùng ban đêm                              -> heatmap "Nhịp sử dụng"
--   - Tài khoản bị khoá (ngừng dùng ~45 ngày trước)   -> icon khoá, nút ẩn tài khoản khoá
--   - Nhân viên mới (chỉ ~20 ngày), nhân viên mẫu nhỏ -> lọc MIN_SAMPLE = 5
--   - Nhân viên chưa từng dùng AI                     -> hiển thị "—"
--   - 1 ngày chi tiêu đột biến (11 ngày trước)        -> chip "Đỉnh"
--   - 1 ngày sự cố nhiều lỗi (20 ngày trước)          -> cột lỗi, "Lý do lỗi phổ biến"
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Đảm bảo có roles (giống database/seeds/0001_roles.sql, an toàn nếu đã có)
-- ---------------------------------------------------------------------------
INSERT INTO roles (id, name, description) VALUES
  (1, 'admin',    'Quản trị hệ thống'),
  (2, 'employee', 'Nhân viên')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('roles', 'id'), (SELECT MAX(id) FROM roles));

-- ---------------------------------------------------------------------------
-- 1. Dọn dữ liệu seed cũ (ai_generations... tự xoá theo ON DELETE CASCADE)
-- ---------------------------------------------------------------------------
DELETE FROM users WHERE email LIKE '%@seed.local';

-- ---------------------------------------------------------------------------
-- 2. Hồ sơ nhân viên demo (role_id = 2 => nằm trong thống kê chi phí)
--    base_per_day : số yêu cầu trung bình / ngày làm việc
--    w_*          : tỷ trọng chat / ảnh / video / giọng nói (tổng = 1)
--    fail_rate    : xác suất lỗi cơ sở      retry_rate : xác suất lặp lại prompt cũ
--    start_off / end_off : hoạt động từ N ngày trước đến M ngày trước (0 = hôm nay)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _seed_profiles (
  slot         INT PRIMARY KEY,
  email        TEXT,
  username     TEXT,
  full_name    TEXT,
  phone        TEXT,
  status       TEXT,
  base_per_day NUMERIC,
  w_chat       NUMERIC,
  w_image      NUMERIC,
  w_video      NUMERIC,
  w_audio      NUMERIC,
  fail_rate    NUMERIC,
  retry_rate   NUMERIC,
  owl          BOOLEAN,
  start_off    INT,
  end_off      INT
) ON COMMIT DROP;

INSERT INTO _seed_profiles VALUES
  ( 1, 'minh.anh@seed.local',   'minh.anh',   'Nguyễn Minh Anh',   '0901000001', 'active',  7.0, 0.30, 0.35, 0.28, 0.07, 0.06, 0.12, false, 149,   0), -- sáng tạo video, chi nhiều nhất
  ( 2, 'quoc.bao@seed.local',   'quoc.bao',   'Trần Quốc Bảo',     '0901000002', 'active', 14.0, 0.85, 0.08, 0.03, 0.04, 0.03, 0.10, false, 149,   0), -- dev, chat rất nhiều, rẻ
  ( 3, 'thu.ha@seed.local',     'thu.ha',     'Lê Thu Hà',         '0901000003', 'active',  9.0, 0.20, 0.65, 0.12, 0.03, 0.08, 0.30, false, 149,   0), -- designer, hay tạo lại ảnh
  ( 4, 'gia.huy@seed.local',    'gia.huy',    'Phạm Gia Huy',      '0901000004', 'active',  4.0, 0.20, 0.25, 0.50, 0.05, 0.16, 0.35, false, 120,   0), -- video, nhiều lỗi + lặp prompt
  ( 5, 'khanh.linh@seed.local', 'khanh.linh', 'Võ Khánh Linh',     '0901000005', 'active',  6.0, 0.45, 0.30, 0.15, 0.10, 0.05, 0.15, false, 149,   0), -- marketing, dùng đều
  ( 6, 'hoang.nam@seed.local',  'hoang.nam',  'Đặng Hoàng Nam',    '0901000006', 'active',  5.0, 0.55, 0.10, 0.05, 0.30, 0.04, 0.08, true,  149,   0), -- cú đêm, nhiều giọng nói
  ( 7, 'thao.vy@seed.local',    'thao.vy',    'Bùi Thảo Vy',       '0901000007', 'active',  5.0, 0.40, 0.35, 0.15, 0.10, 0.07, 0.18, false,  20,   0), -- nhân viên mới (~20 ngày)
  ( 8, 'duc.thinh@seed.local',  'duc.thinh',  'Hoàng Đức Thịnh',   '0901000008', 'active',  1.5, 0.80, 0.10, 0.05, 0.05, 0.10, 0.20, false, 149,   0), -- ít dùng
  ( 9, 'mai.phuong@seed.local', 'mai.phuong', 'Ngô Mai Phương',    '0901000009', 'active',  6.0, 0.40, 0.38, 0.10, 0.12, 0.01, 0.03, false, 149,   0), -- hiệu quả nhất
  (10, 'tan.phat@seed.local',   'tan.phat',   'Đỗ Tấn Phát',       '0901000010', 'banned',  5.0, 0.40, 0.30, 0.25, 0.05, 0.09, 0.20, false, 149,  45), -- bị khoá, ngừng dùng 45 ngày trước
  (11, 'bao.chau@seed.local',   'bao.chau',   'Phan Bảo Châu',     '0901000011', 'active',  0.25, 0.60, 0.30, 0.05, 0.05, 0.05, 0.10, false,   9,   0), -- mẫu nhỏ (< 5 lượt)
  (12, 'nhat.quang@seed.local', 'nhat.quang', 'Trương Nhật Quang', '0901000012', 'active',  0.0, 0.70, 0.20, 0.05, 0.05, 0.00, 0.00, false,   0,   0); -- chưa từng dùng AI

INSERT INTO users (role_id, email, password_hash, full_name, username, phone, status, last_login_at, created_at, updated_at)
SELECT 2, p.email,
       -- bcrypt (cost 12) của "Employee@123"
       '$2b$12$Sg.OGNBXmOgRePNDvd1Hl.lKQoL/Fc6Lx3qIK5qxB8mSXI8KGP7LK',
       p.full_name, p.username, p.phone, p.status,
       now() - (p.end_off * interval '1 day') - (random() * interval '6 hours'),
       now() - ((p.start_off + 15) * interval '1 day'),
       now()
FROM _seed_profiles p;

-- ---------------------------------------------------------------------------
-- 3. Danh mục model minh hoạ (weight = tỷ trọng chọn trong cùng modality)
--    cost_min/max : tiền thu của khách (VND) / lượt      lat_min/max : giây xử lý
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _seed_models (
  modality TEXT, slug TEXT, name TEXT, source TEXT,
  weight NUMERIC, cost_min INT, cost_max INT, lat_min INT, lat_max INT,
  cum_lo NUMERIC, cum_hi NUMERIC
) ON COMMIT DROP;

INSERT INTO _seed_models (modality, slug, name, source, weight, cost_min, cost_max, lat_min, lat_max) VALUES
  ('chat',  'openai/gpt-4o-mini',               'GPT-4o mini',            'openrouter', 0.40,   150,    700,   2,  12),
  ('chat',  'google/gemini-2.5-flash',          'Gemini 2.5 Flash',       'openrouter', 0.25,   200,    900,   2,  10),
  ('chat',  'openai/gpt-4o',                    'GPT-4o',                 'openrouter', 0.15,  1200,   5000,   4,  25),
  ('chat',  'anthropic/claude-sonnet-4',        'Claude Sonnet 4',        'openrouter', 0.15,  1500,   7000,   5,  30),
  ('chat',  'google/gemini-2.5-pro',            'Gemini 2.5 Pro',         'openrouter', 0.05,  2000,   9000,   6,  35),
  ('image', 'google/gemini-2.5-flash-image',    'Gemini 2.5 Flash Image', 'openrouter', 0.45,   950,   1100,   6,  14),
  ('image', 'openai/gpt-image-1',               'GPT Image 1',            'openrouter', 0.30,  1800,   7500,  15,  45),
  ('image', 'black-forest-labs/flux-1.1-pro',   'FLUX 1.1 Pro',           'openrouter', 0.25,   700,   1700,   8,  25),
  ('video', 'kling/kling-3.0-turbo',            'Kling: 3.0 Turbo',       'kling',      0.35,  8000,  30000,  60, 180),
  ('video', 'kling/kling-3.0',                  'Kling: 3.0',             'kling',      0.40, 15000,  70000,  90, 300),
  ('video', 'kling/kling-3.0-omni',             'Kling: 3.0 Omni',        'kling',      0.15, 25000,  90000, 120, 360),
  ('video', 'kling/kling-o1',                   'Kling: O1',              'kling',      0.10, 22000,  80000, 120, 330),
  ('audio', 'openai/gpt-4o-mini-tts',           'GPT-4o mini TTS',        'openrouter', 0.60,   250,    900,   3,   9),
  ('audio', 'openai/tts-1-hd',                  'TTS-1 HD',               'openrouter', 0.40,   400,   1500,   4,  12);

-- cộng dồn trọng số theo từng modality để chọn model bằng 1 số ngẫu nhiên
UPDATE _seed_models m
SET cum_hi = c.cum, cum_lo = c.cum - m.weight
FROM (
  SELECT slug, SUM(weight) OVER (PARTITION BY modality ORDER BY slug ROWS UNBOUNDED PRECEDING) AS cum
  FROM _seed_models
) c
WHERE c.slug = m.slug;

-- ---------------------------------------------------------------------------
-- 4. Sinh các lượt yêu cầu thô: mỗi dòng = 1 lượt, kèm các số ngẫu nhiên cần dùng
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _seed_raw ON COMMIT DROP AS
SELECT
  u.id            AS user_id,
  p.slot, p.fail_rate, p.retry_rate, p.owl,
  p.w_chat, p.w_image, p.w_video,
  d.off,
  random() AS r_mod,   random() AS r_model, random() AS r_stat,  random() AS r_cost,
  random() AS r_retry, random() AS r_hsel,  random() AS r_h1,    random() AS r_h2,
  random() AS r_min,   random() AS r_sec,   random() AS r_lat,   random() AS r_prompt,
  random() AS r_err,   random() AS r_tok
FROM _seed_profiles p
JOIN users u ON u.email = p.email
CROSS JOIN LATERAL generate_series(p.end_off, p.start_off) AS d(off)
CROSS JOIN LATERAL (
  -- số lượt trong ngày: nền × tăng trưởng × cuối tuần × ngày đột biến × ngẫu nhiên
  SELECT floor(
    p.base_per_day
    * (0.6 + 0.4 * (1 - d.off / 150.0))                                                   -- dùng ngày càng nhiều
    * CASE WHEN EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - d.off * interval '1 day') >= 6
           THEN 0.2 ELSE 1 END                                                            -- cuối tuần ít hơn
    * CASE WHEN d.off = 11 THEN 2.4 ELSE 1 END                                            -- ngày đột biến
    * (0.5 + random())
    + random()
  )::int AS n
) cnt
CROSS JOIN LATERAL generate_series(1, cnt.n) AS g(i)
WHERE p.base_per_day > 0;

-- ---------------------------------------------------------------------------
-- 5. Chọn modality, giờ, model, trạng thái, chi phí...
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _seed_pick ON COMMIT DROP AS
SELECT
  r.*,
  CASE
    WHEN r.r_mod < r.w_chat                         THEN 'chat'
    WHEN r.r_mod < r.w_chat + r.w_image             THEN 'image'
    WHEN r.r_mod < r.w_chat + r.w_image + r.w_video THEN 'video'
    ELSE 'audio'
  END AS modality,
  -- giờ trong ngày (giờ Việt Nam)
  CASE
    WHEN r.owl THEN
      CASE WHEN r.r_hsel < 0.55 THEN 20 + floor(r.r_h1 * 4)::int
           WHEN r.r_hsel < 0.80 THEN floor(r.r_h1 * 3)::int
           ELSE 13 + floor(r.r_h1 * 6)::int END
    ELSE
      CASE WHEN r.r_hsel < 0.05 THEN 18 + floor(r.r_h1 * 3)::int                         -- tăng ca
           WHEN r.r_hsel < 0.52 THEN 8  + floor((r.r_h1 + r.r_h2) * 2.5)::int            -- đỉnh buổi sáng
           ELSE                      13 + floor((r.r_h1 + r.r_h2) * 2.5)::int END       -- đỉnh buổi chiều
  END AS hr
FROM _seed_raw r;

CREATE TEMP TABLE _seed_final ON COMMIT DROP AS
SELECT
  k.*,
  m.slug, m.name AS model_name, m.source,
  m.cost_min, m.cost_max, m.lat_min, m.lat_max,
  -- xác suất lỗi theo modality; ngày sự cố (20 ngày trước) lỗi tăng mạnh
  (k.r_stat < LEAST(0.85,
      k.fail_rate * CASE k.modality WHEN 'video' THEN 2.0 WHEN 'chat' THEN 0.4 WHEN 'audio' THEN 0.6 ELSE 1.0 END
      + CASE WHEN k.off = 20 THEN 0.35 ELSE 0 END)
  ) AS is_failed,
  ((date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - k.off * interval '1 day')
     + make_interval(hours => k.hr, mins => floor(k.r_min * 60)::int, secs => floor(k.r_sec * 60)::int)
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh' AS created_at
FROM _seed_pick k
JOIN _seed_models m
  ON m.modality = k.modality AND k.r_model >= m.cum_lo AND k.r_model < m.cum_hi;

-- ---------------------------------------------------------------------------
-- 6. Ghi vào ai_generations (chỉ status succeeded / failed — không có pending,
--    để job đối soát video không đi gọi Kling thật)
-- ---------------------------------------------------------------------------
INSERT INTO ai_generations (
  user_id, modality, model_slug, source, model_name_snapshot, provider_snapshot,
  status, prompt, options, output_urls, usage,
  estimated_min_vnd, estimated_max_vnd, actual_cost_usd, charged_vnd,
  error_message, completed_at, created_at, updated_at
)
SELECT
  f.user_id, f.modality, f.slug, f.source, f.model_name,
  jsonb_build_object('provider', split_part(f.slug, '/', 1), 'seed', true),
  CASE WHEN f.is_failed THEN 'failed' ELSE 'succeeded' END,

  -- Prompt: với xác suất retry_rate dùng lại prompt trong "bể" 6 câu của chính user
  -- (để thống kê "Prompt lặp lại"); còn lại thêm hậu tố duy nhất.
  (ARRAY(
    SELECT unnest(CASE f.modality
      WHEN 'chat'  THEN ARRAY[
        'Viết email chào hàng cho khách hàng mới',
        'Tóm tắt biên bản cuộc họp tuần này',
        'Giải thích lỗi null pointer trong đoạn code này',
        'Gợi ý 10 tiêu đề bài viết về chuyển đổi số',
        'Dịch đoạn văn sau sang tiếng Anh',
        'Lập kế hoạch nội dung social cho tuần tới',
        'Viết câu SQL tính doanh thu theo tháng',
        'Soát lỗi chính tả bản thảo báo cáo quý']
      WHEN 'image' THEN ARRAY[
        'Ảnh sản phẩm cà phê trên nền gỗ, ánh sáng buổi sáng',
        'Banner khuyến mãi mùa thu tông màu cam',
        'Logo tối giản cho quán trà',
        'Ảnh chân dung doanh nhân phong cách studio',
        'Minh hoạ phố cổ Hà Nội lúc hoàng hôn',
        'Mockup bao bì hộp quà Tết',
        'Ảnh nội thất phòng khách phong cách Nhật',
        'Poster sự kiện công nghệ phong cách neon']
      WHEN 'video' THEN ARRAY[
        'Cảnh quay chậm tách cà phê bốc khói',
        'Drone bay qua cầu Landmark 81 lúc bình minh',
        'Sản phẩm xoay 360 độ trên nền trắng',
        'Nhân vật hoạt hình vẫy tay chào',
        'Chuyển cảnh mượt từ ảnh đầu sang ảnh cuối',
        'Quảng cáo giày chạy bộ trên đường phố ướt mưa',
        'Dòng người đi bộ phố Nguyễn Huệ về đêm',
        'Hoa nở time-lapse trong vườn']
      ELSE ARRAY[
        'Đọc thông báo khuyến mãi bằng giọng nữ miền Nam',
        'Lồng tiếng giới thiệu sản phẩm 30 giây',
        'Đọc bản tin nội bộ giọng nam trầm',
        'Lời chào tổng đài khi khách gọi đến',
        'Đọc truyện ngắn cho podcast',
        'Hướng dẫn sử dụng sản phẩm từng bước',
        'Lời chúc năm mới gửi khách hàng',
        'Đọc quảng cáo radio 15 giây']
    END)
  ))[1 + floor(f.r_prompt * 8)::int]
  || CASE WHEN f.r_retry < f.retry_rate
          THEN ''                                                    -- lặp lại: trùng nguyên văn
          ELSE ' (#' || substr(md5(f.user_id::text || f.off::text || f.r_prompt::text || f.r_tok::text), 1, 6) || ')'
     END,

  CASE f.modality
    WHEN 'image' THEN jsonb_build_object('aspectRatio', (ARRAY['1:1','16:9','9:16','4:3'])[1 + floor(f.r_lat * 4)::int])
    WHEN 'video' THEN jsonb_build_object('duration', 3 + floor(f.r_lat * 8)::int,
                                         'resolution', (ARRAY['720p','1080p','1080p'])[1 + floor(f.r_cost * 3)::int],
                                         'aspectRatio', '16:9')
    WHEN 'audio' THEN jsonb_build_object('voice', (ARRAY['alloy','nova','onyx'])[1 + floor(f.r_lat * 3)::int])
    ELSE '{}'::jsonb
  END,

  CASE WHEN f.is_failed THEN '[]'::jsonb
       ELSE jsonb_build_array('https://res.cloudinary.com/demo/seed/' || f.modality || '/' || substr(md5(f.r_tok::text || f.user_id::text), 1, 12))
  END,

  -- usage: chỉ chat có token (trang chi tiết nhân viên dùng total_tokens)
  CASE WHEN f.modality = 'chat' AND NOT f.is_failed THEN
    jsonb_build_object(
      'prompt_tokens',     200 + floor(f.r_tok * 1800)::int,
      'completion_tokens', 150 + floor(f.r_lat * 2200)::int,
      'total_tokens',      350 + floor(f.r_tok * 1800)::int + floor(f.r_lat * 2200)::int)
  ELSE '{}'::jsonb END,

  floor((f.cost_min + f.r_cost * (f.cost_max - f.cost_min)) * 0.9)::bigint,
  ceil ((f.cost_min + f.r_cost * (f.cost_max - f.cost_min)) * 1.15)::bigint,

  CASE WHEN f.is_failed THEN NULL
       ELSE round(((f.cost_min + f.r_cost * (f.cost_max - f.cost_min)) / 25400.0
                   / CASE WHEN f.modality = 'video' THEN 1.0 ELSE 1.2 END)::numeric, 8)
  END,

  -- lượt lỗi không tính tiền (charged_vnd = NULL) — giống luồng thực tế của backend
  CASE WHEN f.is_failed THEN NULL
       ELSE ceil((f.cost_min + f.r_cost * (f.cost_max - f.cost_min)) / 10.0)::bigint * 10 END,

  CASE WHEN f.is_failed THEN
    CASE
      WHEN f.modality = 'video' AND f.r_err < 0.35 THEN 'Kling task failed: nội dung bị chặn bởi bộ lọc kiểm duyệt'
      WHEN f.modality = 'video' AND f.r_err < 0.55 THEN 'Ảnh đầu vào không hợp lệ hoặc vượt quá dung lượng cho phép'
      WHEN f.r_err < 0.40 THEN 'Provider timeout: không nhận được phản hồi sau 120 giây'
      WHEN f.r_err < 0.62 THEN 'Rate limit exceeded, vui lòng thử lại sau'
      WHEN f.r_err < 0.82 THEN 'Nội dung bị từ chối bởi bộ lọc an toàn của nhà cung cấp'
      ELSE 'Upstream provider returned 502 Bad Gateway'
    END
  END,

  -- thời điểm hoàn tất: lỗi thường trả về sớm hơn
  f.created_at + make_interval(secs =>
    CASE WHEN f.is_failed THEN 3 + f.r_lat * 87
         ELSE f.lat_min + f.r_lat * (f.lat_max - f.lat_min) END),
  f.created_at,
  f.created_at + make_interval(secs =>
    CASE WHEN f.is_failed THEN 3 + f.r_lat * 87
         ELSE f.lat_min + f.r_lat * (f.lat_max - f.lat_min) END)
FROM _seed_final f
WHERE f.created_at < now() - interval '2 minutes';   -- không tạo lượt ở tương lai

-- ---------------------------------------------------------------------------
-- 7. (Tuỳ chọn) tài khoản admin để đăng nhập xem trang. Bỏ comment nếu cần.
--    Hoặc dùng: BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... npm run create-admin
-- ---------------------------------------------------------------------------
-- INSERT INTO users (role_id, email, password_hash, full_name, status)
-- VALUES (1, 'admin@seed.local', '$2b$12$Sg.OGNBXmOgRePNDvd1Hl.lKQoL/Fc6Lx3qIK5qxB8mSXI8KGP7LK', 'Admin Demo', 'active')
-- ON CONFLICT (email) DO NOTHING;     -- mật khẩu: Employee@123

COMMIT;

-- ---------------------------------------------------------------------------
-- Tóm tắt nhanh để đối chiếu với trang (khoảng 30 ngày gần nhất)
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*)                                                         AS tong_yeu_cau,
  COUNT(*) FILTER (WHERE g.status = 'succeeded')                   AS thanh_cong,
  COUNT(*) FILTER (WHERE g.status = 'failed')                      AS loi,
  COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0) AS tong_chi_vnd,
  COUNT(DISTINCT g.user_id) FILTER (WHERE g.status = 'succeeded')  AS nguoi_chi_tieu
FROM ai_generations g
JOIN users u ON u.id = g.user_id
WHERE u.email LIKE '%@seed.local'
  AND g.created_at >= now() - interval '30 days';
