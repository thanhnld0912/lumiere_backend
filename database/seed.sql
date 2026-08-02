-- ============================================================================
-- Lumiere — SEED (tuỳ chọn, chạy TAY sau schema.sql)
--
--   npm run db:seed
--
-- Đây KHÔNG phải fake data: toàn bộ 10 novel / 6 nhóm dịch / 13 chương dưới đây
-- được migrate 1-1 từ E:\Code\Lumiere_frontend\src\data\mockData.ts — chính là
-- dữ liệu mà frontend đang render hôm nay. Mục đích là để API có gì đó trả về
-- lúc phát triển, thay vì mảng rỗng.
--
-- Các string đã format trong mock được chuyển ngược về SỐ THÔ (quyết định Q1):
--   '12.4k'          -> 12400          (ratings_count)
--   '2.8M Readers'   -> 2800000        (total_views)
--   '+8k'            -> 8000           (recommendations_count)
--   'Oct 12, 2023'   -> timestamptz    (published_at)
-- Presenter layer ở backend sẽ format ngược lại đúng như cũ khi trả JSON.
--
-- Idempotent: ON CONFLICT DO UPDATE, chạy lại nhiều lần an toàn.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Translation groups
--
-- Lưu ý: mockData.ts gán `quality` KHÁC NHAU cho cùng một nhóm ở các novel khác
-- nhau (VD 'Aetheric Scans' là 'Primary Translation Group • High Quality' ở
-- mockData.ts:19, 'Primary' ở :167, 'High Quality' ở :207). Vì nhóm dịch là một
-- thực thể dùng chung, ở đây lấy giá trị đầy đủ nhất.
-- ─────────────────────────────────────────────────────────────
INSERT INTO translation_groups (slug, name, quality, avatar_url, site_url) VALUES
  ('aetheric-scans', 'Aetheric Scans', 'Primary Translation Group • High Quality',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuDk2fVlvylvFOj_o4N8tIpCbqXj0eLieTWRaHqDn771qC_n_2JUgYj3_fMFcUq2-KkBONFNH-C2xhNLsGOI5RFr4h55OqOi7-wgkkFeFBX_dH3k0Un311h24OWjZY47cuKhhSt1QYEmjCzH_WdthAFSSROPYSnHWsV1cmSfRgz1wqmHYX82mdRzSCA9tfHO8KQTQk4Q39-2j5_GHH13rIICK3n6ThOWYwHlrj07QOjC2yn4rbiFC-qN',
   'https://aetheric-scans.example.com'),
  ('sky-novels', 'Sky Novels', 'Official Scanlation',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuDk2fVlvylvFOj_o4N8tIpCbqXj0eLieTWRaHqDn771qC_n_2JUgYj3_fMFcUq2-KkBONFNH-C2xhNLsGOI5RFr4h55OqOi7-wgkkFeFBX_dH3k0Un311h24OWjZY47cuKhhSt1QYEmjCzH_WdthAFSSROPYSnHWsV1cmSfRgz1wqmHYX82mdRzSCA9tfHO8KQTQk4Q39-2j5_GHH13rIICK3n6ThOWYwHlrj07QOjC2yn4rbiFC-qN',
   'https://skynovels.example.com'),
  ('abyss-scans',  'Abyss Scans',  'HD Scans', '', ''),
  ('desert-scans', 'Desert Scans', 'Standard', '', ''),
  ('cyberscans',   'CyberScans',   'Premium',  '', ''),
  ('gearhead',     'Gearhead',     'Standard', '', '')
ON CONFLICT (slug) DO UPDATE
  SET name       = EXCLUDED.name,
      quality    = EXCLUDED.quality,
      avatar_url = EXCLUDED.avatar_url,
      site_url   = EXCLUDED.site_url;

-- ─────────────────────────────────────────────────────────────
-- Novels
-- ─────────────────────────────────────────────────────────────
INSERT INTO novels (
  slug, title, author, artist, cover_url, backdrop_url, rating, ratings_count,
  status, total_chapters, synopsis, translation_group_id, release_frequency,
  total_views, recommendations_count
)
SELECT v.slug, v.title, v.author, v.artist, v.cover_url, v.backdrop_url,
       v.rating, v.ratings_count, v.status::novel_status, v.total_chapters,
       v.synopsis, tg.id, v.release_frequency, v.total_views, v.recommendations_count
FROM (VALUES
  -- slug, title, author, artist, cover_url, backdrop_url, rating, ratings_count,
  -- status, total_chapters, synopsis, group_slug, release_frequency, total_views, rec_count
  ('shadow-of-the-void',
   'Shadow of the Void', 'Aris Thorne', 'Kaelen Thorne',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuARtcjG0Jhla_j1krti4Gz7ZyhY8U-Z8ekciM3kF5qha7_Ju3Fqun-8Jk0mSiEIuGHuj4ux79Qy9eTn-hrhRszKyEQsrB6CRso2rpRyQyK2HtesjJFeR8EEiJUFVi4vaD7axUakASpkpMLVOFTYr9bcja3XI3lJfggxRVy4FOj711GE5uoRhfSzmUaAeg8FoQnXGSnHEJ4P3iXXApmBRxsklirmPLw_bR2ukId8tGo34AMglg0BEAW7',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuAUqNJFHKf5QrHrIFNeKaxrNIi1yb3APE3YQ1vCoPEYd_x6vygw17tzbKEJusardGE5XGX1qBM-cRwuvtQKadUO4qeYRmX1wWwkWOt3Gedi0acTn5XI5IIPLKYTKgQeSRUtlhJHgYxtlWJB3BMf75WdZ4hgQq-OnzypLGwecIdbFz55FR4zxd0BUcsA6zSnJ9CyB1jCufxncx5x2RjgZdeR4hTkPwoC1VVrgdwShr2JtvJKKG39025T',
   4.90, 12400, 'Ongoing', 243,
   'In a world where the sun has been eclipsed for a century, Kaelen survives in the neon-lit gutters of the Lower Spire. He was born with a mark of the ''Void Walker''—a curse that allows him to slip into the spaces between reality. When the Citadel''s elite forces begin hunting those with the mark, Kaelen is forced into a cosmic game of survival that spans multiple dimensions. As the shadows grow longer, he discovers that the void isn''t just an empty space; it''s a hungry entity waiting for the right key to unleash its ancient terror.',
   'aetheric-scans', '3 Chapters / Week', 2800000, 8000),

  ('eternal-archive',
   'The Eternal Archive: Chronicles of the Void-Born', 'Elara Vance', NULL,
   'https://lh3.googleusercontent.com/aida-public/AB6AXuBbXsp_u-Xqg_BEBrpd1aekcFhe9qFTq2jgWKmsaudsspXAOqWkMSXwIMTwawUzas2Uajp--uvVJsRDXdHeaUvrCWGzCnQWnuzpeeoJyQRE3iXw_INvxY4gc_5fT4naYjpkzOgb401OMk9z712KS81_b4cH7X08vDMzksMDeVVySzcvw6GOPE6q0rOHzOgIwkHT8Pbr67ulxL1X5yhhmsIvbPcFUc09mqywQIU-o3zPlrPAhBRQuV0w',
   NULL, 4.95, 28100, 'Ongoing', 120,
   'Deep within the Ivory Tower of Aethelgard, Elara uncovers a manuscript written in bioluminescent violet ink. As she turns the pages, history itself begins to rewrite around her, drawing her into an ancient interstellar war.',
   'sky-novels', '5 Chapters / Week', 4100000, 12000),

  ('neon-moonlight-whispers',
   'Neon Moonlight Whispers', 'Kaelen Thorne', NULL,
   'https://lh3.googleusercontent.com/aida-public/AB6AXuAFHE3xrQ2m8F519q_QsLbKIoPxO_n7PV2NWebt3yOZ2945J3PkMXx2Ye2gBFhhATPjnnKRgAE0ekBs2zBm0CNyTaegI5QoGbbjE6qOT7UVXDnbKEbh9JhtN73PRZd1hz12iPa4J-CwvLLacim4JR1tp7KCf8trhCL4Xi8F-uXBPzNhf1XsLixfP12rlCioUnYNsQBmkaKKLhaFphJ4eOgCdo7kOekVkxfhu4E5QHm7-mfy8Up5FWkw',
   NULL, 4.80, 15200, 'Ongoing', 85,
   'In a gothic cathedral overlooking a neon-drenched metropolis, a silver-haired mage conducts secret rituals through stained-glass data arrays.',
   'abyss-scans', '2 Chapters / Week', 1900000, 5000),

  ('sands-of-the-triple-moon',
   'Sands of the Triple Moon', 'Reid Kadowaki', NULL,
   'https://lh3.googleusercontent.com/aida-public/AB6AXuClN3b_tgveQUJZyV4FepVYt22U2W5CH_r8GeyCyZxWDALD650Fb6Stt8IDe4du7L5TmneBCsCM8JhCuYeANH_6s-FmRzXsnbG48C06ob7Ygfs6Bc1UyYSveHNRGQXpZaUifDee63WUeGLIwCpLXY7UfP-XZ_J4hV_CY2Xn4g_0250d4dlkuXCg05OxDFVJw3Bv37MwuLfA5FjJy2v-M_meB7H5DJkiyWWOBRgq3oxwAd-MW_UXpMno',
   NULL, 4.70, 9800, 'Ongoing', 60,
   'Traversing a desert of bioluminescent azure sand under three celestial moons, a lone wanderer seeks the Lost Reliquary.',
   'desert-scans', '1 Chapter / Week', 980000, 2000),

  ('glitch-protocol-zenith',
   'Glitch Protocol: Zenith', 'Hikari Tanaka', NULL,
   'https://lh3.googleusercontent.com/aida-public/AB6AXuBg_NjgWsJqU4VroplgwxH3uk3Q6hujle56u5yorOk6u76qW3JmFxia8-iESiLAvqGwujqqwYYVTTCAduSP6D_9NSeb5lbqnWwqYWny2whJOl2jRQuCgyqKKA6bHFAxo96l12uqoOq-SYzJKvp6xK-B01g2IArd5lPC0cv047S4opn4aqC-SPJ474vNdHRI_g7aBlvZOrb2hv3yDaw3uqE9pooerF8ByZlcBhU79VLAvTWs1LuMsfcA',
   NULL, 4.90, 21000, 'Ongoing', 90,
   'A high-octane cyberpunk thrill ride following an rogue netrunner attempting the ultimate data heist in futuristic Neo-Tokyo.',
   'cyberscans', '4 Chapters / Week', 3500000, 9000),

  ('shadow-protocol-rebirth',
   'Shadow Protocol: Rebirth', 'Sora Vance', NULL,
   'https://lh3.googleusercontent.com/aida-public/AB6AXuBzPVABn9wkHcHKrS3xb1rhLZ9T4hGG8O2npN3oUb-ypCYzboWxpcckCHQ7HSLtLYvrL11c10EdRtKSJlD2xu-Vr-Y8ivbFdWWAsEELP1exnwsXuxkz283Igs-Ds9ra_oiX4Tv9CP2bH6lNsGcGs4xRJf0EhT8JN47wpYpRv3rfJu2ex8l3mCQxArsKp9mYkveSTq6B5zmfQmKG7hquj5dgzH62oPr_POhq71tAF1ZyAtQPt1slTJFw',
   NULL, 4.80, 4800, 'Ongoing', 110,
   'A deadly cyber-sorceress wielding glowing data-shards fights to reclaim her memories in a drenched neon metropolis.',
   'aetheric-scans', '3 Chapters / Week', 1200000, 3000),

  ('echoes-of-the-digital-petals',
   'Echoes of the Digital Petals', 'Hikari Tanaka', NULL,
   'https://lh3.googleusercontent.com/aida-public/AB6AXuDiiI4V8KfTZekqZbVMVjleFhSFPnQi9uwoCYOsQTHOvWfoqkIG1wkRtwyrpjcka2zDt9qgHCo30IvXJebWhh7GJPDg9nkZserWBDlDrZSDnuB2zDm-pJMtumn3_iXWPcDqWbme0JoyKswlLiFhJAbyUyEJ2e8gYbzfs9JjE09KTfg8Z9-WYQIK6CbdVmMzscoui-uGDuRCXkpOxAdq3KbE1fXsfMrkW7xkgA2aMicZFaY36A8ov4P6',
   NULL, 4.90, 12200, 'Ongoing', 45,
   'Holographic cherry blossoms gently float across a serene traditional garden in a utopian floating biosphere.',
   'sky-novels', '2 Chapters / Week', 2100000, 6000),

  ('celestial-scale-sovereign',
   'Celestial Scale Sovereign', 'Aris Thorne', NULL,
   'https://lh3.googleusercontent.com/aida-public/AB6AXuApUPZhvULlPFoCdVs-RUUQS3DSCbmJHtJKMuL5SaCU-UmUvxdbm6syLcWuoPCONuS-Mxn0JiljSW3i9BKN-uRZ73cLvpPR83zU4Ori_yyUi92nNWt7dnkUhXoB-qUY7iFndcwAeXFA6p0LbKOOHPWjkl0k35_KLiEZ3JvufNZz9eJTHyhKMupz9vSXgwhcnGN2vTwtAl26tHTLLZpIgs8S0r-abqnFqSwU3mm08TtjxuHd04aeNbuq',
   NULL, 4.60, 3100, 'Ongoing', 180,
   'A dragon forged from living stellar constellations descends upon the mortal realms to restore cosmological balance.',
   'aetheric-scans', '3 Chapters / Week', 1400000, 4000),

  ('echoes-of-neon',
   'Echoes of Neon', 'Reid Kadowaki', NULL,
   'https://lh3.googleusercontent.com/aida-public/AB6AXuAZw6cS_dM1QxD_jEonmvl7--_fbcm7-etChjznKlGK4q4kCMnLFnVM9K5Bnb-pWeGZOb0G1Fq9NTHk9GwVx8rtvybL2zlHBJHvSs0oi9Gh7Hus59fiMBafOE4pDAnNSHJZDSQX8SWKyc-XaZY6bG5_3NefSpz-HF-vwktoEWnnNTaisxfB4f8BU9t0X_sl-JQ0KNJOzy-7l0ZbJihJeUNFH6GryQx-6ylUrgnNaMoO2-9mCuztJVMw',
   NULL, 4.70, 7400, 'Ongoing', 72,
   'Beneath the neon glow of Spire 9, an underground investigator traces a conspiracy that threatens the digital grid.',
   'abyss-scans', '2 Chapters / Week', 1100000, 3000),

  ('lunar-despair',
   'Lunar Despair', 'Kaelen Thorne', NULL,
   'https://lh3.googleusercontent.com/aida-public/AB6AXuDk8LwDH5aQLgiujiKZk59UeNzz-Gn-IeAMnzJskO8LSqGFFzsCOcM3nGYyetYWhO6LgdwWy7UwBbNt13UV0oZtSsl-mzNAPEJAypn_17Wtj5DEer_mHrNpeARfb2LcZPJ8AVMUce0Muua2hcA_KSiwO64UqidUvIHgiSJsHYT2DhFkMwIcmVZvjUqMhMOSss5YyDYSSWCUC1ngIJnV3Wku12Kq01wNk7PC6o5ab0Cwx9don3AVSpqu',
   NULL, 4.50, 5200, 'Ongoing', 54,
   'Under a blood-red moon, ancient dragons awaken from slumber to challenge the knights of the Order of Cinders.',
   'gearhead', '1 Chapter / Week', 850000, 2000)
) AS v (slug, title, author, artist, cover_url, backdrop_url, rating, ratings_count,
        status, total_chapters, synopsis, group_slug, release_frequency,
        total_views, recommendations_count)
LEFT JOIN translation_groups tg ON tg.slug = v.group_slug
ON CONFLICT (slug) DO UPDATE
  SET title                 = EXCLUDED.title,
      author                = EXCLUDED.author,
      artist                = EXCLUDED.artist,
      cover_url             = EXCLUDED.cover_url,
      backdrop_url          = EXCLUDED.backdrop_url,
      rating                = EXCLUDED.rating,
      ratings_count         = EXCLUDED.ratings_count,
      status                = EXCLUDED.status,
      total_chapters        = EXCLUDED.total_chapters,
      synopsis              = EXCLUDED.synopsis,
      translation_group_id  = EXCLUDED.translation_group_id,
      release_frequency     = EXCLUDED.release_frequency,
      total_views           = EXCLUDED.total_views,
      recommendations_count = EXCLUDED.recommendations_count;

-- ─────────────────────────────────────────────────────────────
-- Novel ↔ Genre (thứ tự `position` giữ nguyên như mảng trong mockData.ts,
-- vì HomeView.tsx:219 render genres[0])
-- ─────────────────────────────────────────────────────────────
INSERT INTO novel_genres (novel_id, genre_id, position)
SELECT n.id, g.id, v.position
FROM (VALUES
  ('shadow-of-the-void',           'Fantasy',       0),
  ('shadow-of-the-void',           'Seinen',        1),
  ('shadow-of-the-void',           'Mystery',       2),
  ('shadow-of-the-void',           'Psychological', 3),
  ('shadow-of-the-void',           'Action',        4),
  ('eternal-archive',              'Fantasy',       0),
  ('eternal-archive',              'Mystery',       1),
  ('eternal-archive',              'Magic',         2),
  ('neon-moonlight-whispers',      'Fantasy',       0),
  ('neon-moonlight-whispers',      'Cyberpunk',     1),
  ('neon-moonlight-whispers',      'Gothic',        2),
  ('sands-of-the-triple-moon',     'Adventure',     0),
  ('sands-of-the-triple-moon',     'Sci-Fi',        1),
  ('sands-of-the-triple-moon',     'Fantasy',       2),
  ('glitch-protocol-zenith',       'Cyberpunk',     0),
  ('glitch-protocol-zenith',       'Action',        1),
  ('glitch-protocol-zenith',       'Thriller',      2),
  ('shadow-protocol-rebirth',      'Action',        0),
  ('shadow-protocol-rebirth',      'Sci-Fi',        1),
  ('echoes-of-the-digital-petals', 'Slice of Life', 0),
  ('echoes-of-the-digital-petals', 'Romance',       1),
  ('echoes-of-the-digital-petals', 'Sci-Fi',        2),
  ('celestial-scale-sovereign',    'Fantasy',       0),
  ('celestial-scale-sovereign',    'Xianxia',       1),
  ('celestial-scale-sovereign',    'Adventure',     2),
  ('echoes-of-neon',               'Cyberpunk',     0),
  ('echoes-of-neon',               'Thriller',      1),
  ('lunar-despair',                'Fantasy',       0),
  ('lunar-despair',                'Dark',          1)
) AS v (novel_slug, genre_name, position)
JOIN novels n ON n.slug = v.novel_slug
JOIN genres g ON g.name = v.genre_name
ON CONFLICT (novel_id, genre_id) DO UPDATE SET position = EXCLUDED.position;

-- ─────────────────────────────────────────────────────────────
-- Chapters
-- `date` trong mock ('Oct 12, 2023') -> published_at timestamptz.
-- Chú ý slug 'ch-42' xuất hiện ở CẢ shadow-of-the-void lẫn eternal-archive —
-- đúng như phát hiện F2, nên UNIQUE là (novel_id, slug).
-- ─────────────────────────────────────────────────────────────
INSERT INTO chapters (novel_id, slug, number, title, published_at, illustration_url)
SELECT n.id, v.slug, v.number, v.title, v.published_at::timestamptz, v.illustration_url
FROM (VALUES
  ('shadow-of-the-void', 'ch-01',  1, 'The Eclipse of Hope',        '2023-10-12T00:00:00Z', NULL),
  ('shadow-of-the-void', 'ch-02',  2, 'Whispers from the Void',     '2023-10-14T00:00:00Z', NULL),
  ('shadow-of-the-void', 'ch-03',  3, 'The Mark Awakening',         '2023-10-15T00:00:00Z', NULL),
  ('shadow-of-the-void', 'ch-04',  4, 'Citadel of Glass',           '2023-10-18T00:00:00Z', NULL),
  ('shadow-of-the-void', 'ch-05',  5, 'Echoes in the Lower Spire',  '2023-10-22T00:00:00Z', NULL),
  ('shadow-of-the-void', 'ch-06',  6, 'Boundaries of Reality',      '2023-10-26T00:00:00Z', NULL),
  ('shadow-of-the-void', 'ch-42', 42, 'The Awakening',              '2023-11-10T00:00:00Z', NULL),
  ('eternal-archive',    'ch-42', 42, 'The Awakening',              '2024-07-28T00:00:00Z',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuDwsAwroU-K5qvy82J_SbjXVzivnWs9_mzrLwiBHnlTK8p_V6SWkdM4nwa0yimHRxU4fOvAdasuMPtr982e7cPj8PM2AjuDVNmp1jumWsLDjLvgsbAQUz8f4iyZY8oiqyjEcqS1u8GbuDCbHwKCnSXuIHPOsbxddWWi25l67-VWuCbko4Up8jBP9AIu_iEyaQ78EKTc2J6y-26MJGJmZ45eNVsNMcKAfkWddynpHEPU_4RXOzUImQs0'),
  ('neon-moonlight-whispers',      'ch-24', 24, 'The Silent City',  '2024-07-25T00:00:00Z', NULL),
  ('sands-of-the-triple-moon',     'ch-02',  2, 'Arid Awakening',   '2024-07-20T00:00:00Z', NULL),
  ('glitch-protocol-zenith',       'ch-88', 88, 'Final Upload',     '2024-07-26T00:00:00Z', NULL),
  ('shadow-protocol-rebirth',      'ch-01',  1, 'Data Awakening',   '2024-07-01T00:00:00Z', NULL),
  ('echoes-of-the-digital-petals', 'ch-01',  1, 'Spring in Orbit',  '2024-07-05T00:00:00Z', NULL),
  ('celestial-scale-sovereign',    'ch-01',  1, 'Starfall',         '2024-06-12T00:00:00Z', NULL)
) AS v (novel_slug, slug, number, title, published_at, illustration_url)
JOIN novels n ON n.slug = v.novel_slug
ON CONFLICT (novel_id, slug) DO UPDATE
  SET number           = EXCLUDED.number,
      title            = EXCLUDED.title,
      published_at     = EXCLUDED.published_at,
      illustration_url = EXCLUDED.illustration_url;

-- ─────────────────────────────────────────────────────────────
-- Chapter content — trong mockData.ts chỉ đúng một chương có `content`:
-- eternal-archive / ch-42 (mockData.ts:77-83). Không bịa thêm chương nào.
-- ─────────────────────────────────────────────────────────────
INSERT INTO chapter_contents (chapter_id, paragraphs)
SELECT c.id, ARRAY[
  'The dawn did not break with a roar, but with a whisper of violet light that bled through the heavy velvet curtains of the archives. Elara watched the dust motes dance in the first rays, each speck a tiny universe revolving around the silence of the room. For three days, the silence had been her only companion, save for the rhythmic turning of brittle parchment pages.',
  'The manuscript lay open before her, its ink shimmering with a faint, bioluminescent glow that hadn''t been there when the sun was down. The letters seemed to shift, rearranging themselves not into words, but into memories. She reached out, her fingertips hovering just millimeters above the surface. She could feel the hum of the magic—a low, vibrating frequency that resonated in her very marrow.',
  '"So it begins," she whispered, her voice sounding foreign in the stillness. The awakening wasn''t just in the text; it was a physical sensation, like a long-dormant engine finally catching fire. The archives felt smaller now, the walls less like a sanctuary and more like a shell that she was rapidly outgrowing.',
  'Outside, the city of Aethelgard was still asleep, unaware that the foundation of its history had just been rewritten in a quiet room at the top of the Ivory Tower. Elara closed her eyes, letting the violet light seep through her eyelids. The history of the world was no longer a collection of dates and names. It was a living, breathing thing, and she was its new heartbeat.',
  'She turned the page. The paper felt warm now, pulsing with the rhythm of her own heart. The next chapter wasn''t written in ink, but in light. And for the first time in centuries, the light was beckoning someone to follow.'
]
FROM chapters c
JOIN novels n ON n.id = c.novel_id
WHERE n.slug = 'eternal-archive' AND c.slug = 'ch-42'
ON CONFLICT (chapter_id) DO UPDATE SET paragraphs = EXCLUDED.paragraphs;

-- ─────────────────────────────────────────────────────────────
-- Sync events (nguồn cho GET /api/timeline)
--
-- MOCK CÓ LỖI: MOCK_TIMELINE_ITEMS trỏ tới novelId 'neon-chronicles',
-- 'emerald-whispers', 'gear-and-ghost' — KHÔNG novel nào có id đó, nên
-- TimelineView.tsx:119 phải fallback `|| novels[0]`. Ở DB, novel_id là FK thật
-- nên không thể trỏ vào hư vô. Dưới đây giữ nguyên nhóm dịch và số chương của
-- mock, nhưng gắn vào novel CÓ THẬT của đúng nhóm đó:
--   'Abyss Scans' -> neon-moonlight-whispers   (2h ago,   mockData.ts:260-262)
--   'Sky Novels'  -> eternal-archive           (1d ago,   mockData.ts:271-273)
--   'Gearhead'    -> lunar-despair             (3d ago,   mockData.ts:282-284)
-- ─────────────────────────────────────────────────────────────
DELETE FROM sync_events;

INSERT INTO sync_events (novel_id, translation_group_id, chapters_added_count, occurred_at)
SELECT n.id, tg.id, v.count, now() - v.ago::interval
FROM (VALUES
  ('neon-moonlight-whispers', 'abyss-scans', 5, '2 hours'),
  ('eternal-archive',         'sky-novels',  5, '1 day'),
  ('lunar-despair',           'gearhead',    5, '3 days')
) AS v (novel_slug, group_slug, count, ago)
JOIN novels n              ON n.slug  = v.novel_slug
JOIN translation_groups tg ON tg.slug = v.group_slug;

-- ─────────────────────────────────────────────────────────────
-- Sync run đang chạy (nguồn cho nextSyncCountdown + nextSyncPercentage).
-- mockData.ts:295-296 -> countdown '4m 12s', percentage 74.
-- ─────────────────────────────────────────────────────────────
DELETE FROM sync_runs;

INSERT INTO sync_runs (status, progress_percentage, started_at, next_run_at)
VALUES ('running', 74, now() - interval '10 minutes', now() + interval '4 minutes 12 seconds');

COMMIT;

-- ============================================================================
-- KHỐI TUỲ CHỌN — gắn state per-user của mock vào MỘT tài khoản có sẵn
--
-- Bỏ comment và sửa email bên dưới SAU KHI đã đăng ký tài khoản qua
-- POST /api/auth/register. Khối này tái tạo đúng bookmark / tiến độ đọc /
-- chương đã đọc mà mockData.ts đang mô tả, để test được các endpoint 🔒.
--
-- Nếu email không tồn tại, khối này không làm gì cả (không lỗi).
-- ============================================================================
--
-- DO $$
-- DECLARE
--   v_user_id uuid;
-- BEGIN
--   SELECT id INTO v_user_id FROM users WHERE email = 'ban@example.com';
--   IF v_user_id IS NULL THEN
--     RAISE NOTICE 'Khong tim thay user — bo qua seed per-user.';
--     RETURN;
--   END IF;
--
--   -- isBookmarked: true ở 5 novel đầu (mockData.ts:34,68,105,128,151)
--   INSERT INTO bookmarks (user_id, novel_id)
--   SELECT v_user_id, id FROM novels
--   WHERE slug IN ('shadow-of-the-void', 'eternal-archive', 'neon-moonlight-whispers',
--                  'sands-of-the-triple-moon', 'glitch-protocol-zenith')
--   ON CONFLICT DO NOTHING;
--
--   -- lastReadChapterId + lastReadProgress (mockData.ts:32-33,66-67,103-104,126-127,149-150)
--   INSERT INTO reading_progress (user_id, novel_id, last_chapter_id, progress)
--   SELECT v_user_id, n.id, c.id, v.progress
--   FROM (VALUES
--     ('shadow-of-the-void',       'ch-02', 100),
--     ('eternal-archive',          'ch-42',  45),
--     ('neon-moonlight-whispers',  'ch-24',  75),
--     ('sands-of-the-triple-moon', 'ch-02',  12),
--     ('glitch-protocol-zenith',   'ch-88',  90)
--   ) AS v (novel_slug, chapter_slug, progress)
--   JOIN novels   n ON n.slug = v.novel_slug
--   JOIN chapters c ON c.novel_id = n.id AND c.slug = v.chapter_slug
--   ON CONFLICT (user_id, novel_id) DO UPDATE
--     SET last_chapter_id = EXCLUDED.last_chapter_id, progress = EXCLUDED.progress;
--
--   -- isRead: true (mockData.ts:36-37,107,153)
--   INSERT INTO chapter_reads (user_id, chapter_id)
--   SELECT v_user_id, c.id
--   FROM (VALUES
--     ('shadow-of-the-void',      'ch-01'),
--     ('shadow-of-the-void',      'ch-02'),
--     ('neon-moonlight-whispers', 'ch-24'),
--     ('glitch-protocol-zenith',  'ch-88')
--   ) AS v (novel_slug, chapter_slug)
--   JOIN novels   n ON n.slug = v.novel_slug
--   JOIN chapters c ON c.novel_id = n.id AND c.slug = v.chapter_slug
--   ON CONFLICT DO NOTHING;
--
--   -- translationGroup.isFollowed: true (mockData.ts:22)
--   INSERT INTO group_follows (user_id, group_id)
--   SELECT v_user_id, id FROM translation_groups WHERE slug = 'aetheric-scans'
--   ON CONFLICT DO NOTHING;
-- END $$;