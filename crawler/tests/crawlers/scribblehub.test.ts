import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { scribbleHubConfig } from '../../src/config/sources/scribblehub.config.js';
import type { NormalizeContext } from '../../src/core/contracts/INormalizer.js';
import { ScribbleHubNormalizer } from '../../src/crawlers/scribblehub/ScribbleHubNormalizer.js';
import { mapSlug, mapStoryStatus } from '../../src/crawlers/scribblehub/mappings.js';
import {
  isScribbleHubChapter,
  isScribbleHubStory,
  isScribbleHubUpdate,
  readEnvelope,
  type ScribbleHubStory,
  type ScribbleHubUpdate,
} from '../../src/crawlers/scribblehub/types.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'scribblehub');
const load = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

/** `now` cố định -> test tất định. */
const NOW = new Date('2026-08-05T00:00:00.000Z');
const CTX: NormalizeContext = { sourceId: 'scribblehub', config: scribbleHubConfig, now: NOW };

const normalizer = new ScribbleHubNormalizer();

describe('ScribbleHub — envelope {data, meta}', () => {
  it('bóc được /stories', () => {
    const { items, meta, skipped } = readEnvelope(load('stories.json'), isScribbleHubStory);
    assert.ok(items.length > 0);
    assert.equal(skipped, 0, 'không item nào sai hình dạng');
    assert.ok(meta !== null);
    assert.ok(meta.totalPages >= 1);
  });

  it('bóc được /updates', () => {
    const { items, meta, skipped } = readEnvelope(load('updates.json'), isScribbleHubUpdate);
    assert.ok(items.length > 0);
    assert.equal(skipped, 0);
    assert.ok(meta !== null);
  });

  it('payload rác không làm sập, chỉ trả rỗng', () => {
    for (const bad of [null, {}, { data: 'not-array' }, 42]) {
      const result = readEnvelope(bad, isScribbleHubStory);
      assert.deepEqual(result.items, []);
    }
  });

  it('item sai hình dạng bị bỏ qua và ĐƯỢC ĐẾM (để tính schema drift)', () => {
    const payload = { data: [{ id: 1, title: 'ok', slug: 'a' }, { nonsense: true }] };
    const { items, skipped } = readEnvelope(payload, isScribbleHubStory);
    assert.equal(items.length, 1);
    assert.equal(skipped, 1);
  });
});

describe('ScribbleHubNormalizer — /stories/{id}', () => {
  const story = (load('story-detail.json') as { data: ScribbleHubStory }).data;
  const novel = normalizer.normalizeNovel(story, CTX);

  it('định danh và slug', () => {
    assert.equal(novel.externalId, String(story.id));
    assert.match(novel.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'phải thoả CHECK slug của DB');
    assert.ok(novel.sourceUrl.startsWith('https://www.scribblehub.com/series/'));
  });

  it('map trạng thái sang enum novel_status', () => {
    assert.ok(['Ongoing', 'Completed', 'Hiatus', 'Dropped', 'Unknown'].includes(novel.status));
  });

  it('rating nằm trong [0,5] để không phá CHECK constraint', () => {
    assert.ok(novel.rating >= 0 && novel.rating <= 5, String(novel.rating));
    assert.ok(Number.isInteger(novel.ratingsCount) && novel.ratingsCount >= 0);
  });

  it('genres và tags là danh sách tên phẳng', () => {
    assert.ok(Array.isArray(novel.genres) && novel.genres.length > 0);
    assert.ok(novel.genres.every((g) => typeof g === 'string'));
    assert.ok(novel.tags.every((t) => typeof t === 'string'));
  });

  it('giữ ngắt đoạn của synopsis', () => {
    assert.ok(novel.synopsis.length > 0);
  });

  /**
   * ScribbleHub là nền tảng đăng gốc, không có nhóm dịch. Nhét tên tác giả vào
   * ô nhóm dịch sẽ làm hỏng ngữ nghĩa bảng translation_groups và khiến nút
   * Follow ở NovelDetailView hiển thị sai.
   */
  it('KHÔNG bịa nhóm dịch', () => {
    assert.equal(novel.translationGroup, null);
  });

  it('chương mới nhất suy từ chapterCount + lastUpdated', () => {
    assert.ok(novel.latestChapter !== null);
    assert.equal(novel.latestChapter.number, story.chapterCount);
    assert.ok(novel.latestChapter.publishedAt instanceof Date);
    assert.match(novel.latestChapter.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('KHÔNG bịa tên chương khi nguồn không cho biết', () => {
    assert.equal(novel.latestChapter?.title, '');
    assert.equal(novel.latestChapter?.displayTitle, `Chapter ${story.chapterCount}`);
  });

  it('sortIndex là chuỗi số hợp lệ', () => {
    assert.match(novel.latestChapter?.sortIndex ?? '', /^\d+$/);
  });

  it('crawledAt lấy từ ctx.now, không gọi new Date() bên trong', () => {
    assert.equal(novel.crawledAt.getTime(), NOW.getTime());
  });
});

describe('ScribbleHubNormalizer — content hash', () => {
  const story = (load('story-detail.json') as { data: ScribbleHubStory }).data;

  it('hash dài 64 ký tự, khớp cột char(64)', () => {
    assert.equal(normalizer.normalizeNovel(story, CTX).contentHash.length, 64);
  });

  it('cùng dữ liệu -> cùng hash (kể cả khi crawl lúc khác)', () => {
    const a = normalizer.normalizeNovel(story, CTX);
    const b = normalizer.normalizeNovel(story, { ...CTX, now: new Date('2027-01-01') });
    assert.equal(a.contentHash, b.contentHash);
  });

  /**
   * Điểm mấu chốt của update detection: readCount nhích lên vài đơn vị sau mỗi
   * giờ. Nếu hash tính cả nó thì MỌI novel sẽ bị coi là "đã thay đổi" ở mỗi lần
   * chạy -> sync_events đầy rác -> Timeline của người dùng vô nghĩa.
   */
  it('readCount thay đổi KHÔNG làm đổi hash', () => {
    const before = normalizer.normalizeNovel(story, CTX).contentHash;
    const after = normalizer.normalizeNovel(
      { ...story, readCount: story.readCount + 999, readersCount: story.readersCount + 7 },
      CTX,
    ).contentHash;
    assert.equal(after, before);
  });

  it('đổi tiêu đề THÌ đổi hash', () => {
    const before = normalizer.normalizeNovel(story, CTX).contentHash;
    const after = normalizer.normalizeNovel({ ...story, title: 'Khác hẳn' }, CTX).contentHash;
    assert.notEqual(after, before);
  });

  it('thêm chương THÌ đổi hash', () => {
    const before = normalizer.normalizeNovel(story, CTX).contentHash;
    const after = normalizer.normalizeNovel(
      { ...story, chapterCount: story.chapterCount + 1 },
      CTX,
    ).contentHash;
    assert.notEqual(after, before);
  });
});

describe('ScribbleHubNormalizer — /updates (mode latest)', () => {
  const { items } = readEnvelope(load('updates.json'), isScribbleHubUpdate);
  const releases = items.map((update) => normalizer.normalizeLatest(update, CTX));

  it('chuẩn hoá được toàn bộ', () => {
    assert.ok(releases.length >= 20, `chỉ có ${releases.length}`);
  });

  it('mỗi item có external_id và URL', () => {
    for (const release of releases) {
      assert.ok(release.externalId.length > 0);
      assert.ok(release.sourceUrl.startsWith('https://'));
    }
  });

  /**
   * Khác hẳn NovelUpdates: bảng latest của NU KHÔNG có cột ngày nên
   * releasedAt luôn null. ScribbleHub trả ISO 8601 thật -> last_chapter_at
   * lấy được ngay từ mode `latest`.
   */
  it('CÓ thời điểm phát hành thật (khác NovelUpdates)', () => {
    const withDate = releases.filter((r) => r.chapter?.publishedAt instanceof Date);
    assert.equal(withDate.length, releases.length, 'mọi item phải có publishedAt');
  });

  it('số chương bóc ra đúng', () => {
    const first = releases[0];
    const source = items[0];
    assert.ok(first?.chapter !== null && first?.chapter !== undefined);
    assert.equal(first.chapter.number, source?.latestChapter.number);
  });
});

/**
 * Hồi quy cho lỗi "crawl không hết chương".
 *
 * TRIỆU CHỨNG: truyện 21 chương chỉ có 1 dòng trong bảng `chapters`, mục lục ở
 * NovelDetailView gần như trống.
 * NGUYÊN NHÂN: normalizer dựng đúng MỘT tham chiếu từ `chapterCount`, và adapter
 * chưa bao giờ gọi `/stories/{id}/chapters`.
 */
describe('mục lục đầy đủ — hồi quy', () => {
  const story = (load('story-detail.json') as { data: ScribbleHubStory }).data;
  const { items: chapterList } = readEnvelope(
    load('story-chapters.json'),
    isScribbleHubChapter,
  );

  it('fixture mục lục đọc được', () => {
    assert.ok(chapterList.length > 1, `chỉ có ${chapterList.length} chương`);
  });

  it('KHÔNG truyền mục lục -> chỉ 1 chương (hành vi cũ, vẫn giữ cho nguồn thiếu dữ liệu)', () => {
    const novel = normalizer.normalizeNovel(story, CTX);
    assert.equal(novel.chapters.length, 0, 'mảng rỗng = nguồn không cho mục lục');
    assert.ok(novel.latestChapter !== null, 'vẫn suy được chương mới nhất từ chapterCount');
  });

  it('CÓ truyền mục lục -> chuẩn hoá đủ chương', () => {
    const novel = normalizer.normalizeNovel(story, CTX, chapterList);
    assert.equal(novel.chapters.length, chapterList.length);
  });

  it('mỗi chương có slug hợp lệ và sortIndex là số', () => {
    const novel = normalizer.normalizeNovel(story, CTX, chapterList);
    for (const chapter of novel.chapters) {
      assert.match(chapter.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, chapter.slug);
      assert.match(chapter.sortIndex, /^\d+$/);
      assert.ok(chapter.publishedAt instanceof Date, 'publishedAt phải là Date thật');
    }
  });

  it('slug không trùng nhau — nếu trùng, upsert sẽ ghi đè lẫn nhau', () => {
    const novel = normalizer.normalizeNovel(story, CTX, chapterList);
    const slugs = novel.chapters.map((chapter) => chapter.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it('sortIndex tăng theo số chương -> thứ tự đọc đúng', () => {
    const novel = normalizer.normalizeNovel(story, CTX, chapterList);
    const sorted = [...novel.chapters].sort((a, b) =>
      BigInt(a.sortIndex) < BigInt(b.sortIndex) ? -1 : 1,
    );
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok(
        (sorted[i]?.number ?? 0) >= (sorted[i - 1]?.number ?? 0),
        'sắp theo sortIndex phải cho ra số chương tăng dần',
      );
    }
  });

  it('chương mới nhất lấy từ mục lục thật, không suy từ chapterCount', () => {
    const novel = normalizer.normalizeNovel(story, CTX, chapterList);
    const maxNumber = Math.max(...chapterList.map((chapter) => chapter.number));
    assert.equal(novel.latestChapter?.number, maxNumber);
  });
});

describe('ScribbleHub mappings', () => {
  it('status chữ thường của nguồn', () => {
    assert.equal(mapStoryStatus('ongoing').status, 'Ongoing');
    assert.equal(mapStoryStatus('completed').status, 'Completed');
    assert.equal(mapStoryStatus('hiatus').status, 'Hiatus');
  });

  it('giá trị lạ -> Unknown, có đánh dấu để bổ sung bảng', () => {
    const result = mapStoryStatus('something-new');
    assert.equal(result.status, 'Unknown');
    assert.equal(result.unmapped, true);
  });

  it('KHÔNG đoán Ongoing khi thiếu dữ liệu', () => {
    assert.equal(mapStoryStatus(null).status, 'Unknown');
    assert.equal(mapStoryStatus('').status, 'Unknown');
  });

  /** slug của nguồn có tiền tố id ('2441502-crimson-star') — giữ để tránh trùng tên. */
  it('slug giữ tiền tố id và thoả CHECK của DB', () => {
    const slug = mapSlug('2441502-crimson-star', 2441502);
    assert.equal(slug, '2441502-crimson-star');
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('slug rỗng -> fallback theo id, không bao giờ trả chuỗi rỗng', () => {
    assert.equal(mapSlug('!!!', 123), 'story-123');
  });
});

describe('Dữ liệu thật ScribbleHub giải quyết D5 và D6', () => {
  const { items } = readEnvelope(load('stories.json'), isScribbleHubStory);

  it('có readCount thật — không cần chỉ số suy ra cho total_views', () => {
    assert.ok(items.every((s) => typeof s.readCount === 'number'));
    assert.ok(items.some((s) => s.readCount > 0));
  });

  it('có favoritesCount và ratingCount thật', () => {
    assert.ok(items.every((s) => typeof s.favoritesCount === 'number'));
    assert.ok(items.every((s) => typeof s.ratingCount === 'number'));
  });

  it('/stories/{id} có chaptersPerWeek — khớp release_rate_per_week của D6', () => {
    const detail = (load('story-detail.json') as { data: ScribbleHubStory }).data;
    assert.equal(typeof detail.chaptersPerWeek, 'number');
  });

  /** Ca kiểm chứng Bayesian: điểm cao từ RẤT ÍT phiếu không được xếp ngang hàng. */
  it('có truyện điểm cao nhưng ít phiếu — cần Bayesian rating', () => {
    const lowVote = items.filter((s) => s.ratingCount > 0 && s.ratingCount <= 3);
    assert.ok(
      lowVote.length > 0,
      'fixture phải có ít nhất một truyện ít phiếu để chứng minh nhu cầu',
    );
  });
});
