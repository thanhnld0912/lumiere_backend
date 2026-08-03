import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NovelUpdatesBrowseParser } from '../../src/parsers/novelupdates/NovelUpdatesBrowseParser.js';
import { NovelUpdatesLatestParser } from '../../src/parsers/novelupdates/NovelUpdatesLatestParser.js';
import { NovelUpdatesSeriesParser } from '../../src/parsers/novelupdates/NovelUpdatesSeriesParser.js';
import { extractChapterLabel } from '../../src/extractors/chapter.extractor.js';
import { extractRating } from '../../src/extractors/rating.extractor.js';
import { extractStatus } from '../../src/extractors/status.extractor.js';
import { loadFixture } from '../helpers/fixtures.js';

const SOURCE = 'novelupdates';

describe('NovelUpdatesSeriesParser — humanitys-great-sage', () => {
  const { $, ctx, entry } = loadFixture(SOURCE, 'humanitys-great-sage.html');
  const raw = new NovelUpdatesSeriesParser().parse($, ctx);

  it('external_id lấy đúng từ URL', () => {
    assert.equal(raw.externalId, entry.externalId);
    assert.equal(raw.externalId, 'humanitys-great-sage');
  });

  it('tiêu đề đã giải mã entity', () => {
    // Nguồn ghi 'Humanity&#8217;s Great Sage'
    assert.equal(raw.title, 'Humanity’s Great Sage');
  });

  it('ảnh bìa là URL tuyệt đối', () => {
    assert.ok(raw.coverUrl?.startsWith('https://'), raw.coverUrl ?? '(null)');
  });

  it('tên khác tách theo <br>, giữ được cả chữ Hán', () => {
    assert.ok(raw.altTitles.includes('The Great Sage of Humanity'), raw.altTitles.join(' | '));
    assert.ok(raw.altTitles.includes('人道大圣'), raw.altTitles.join(' | '));
  });

  it('nhiều tác giả', () => {
    assert.ok(raw.authors.length >= 2, raw.authors.join(' | '));
    assert.ok(raw.authors.includes('Momo'));
  });

  it('genres và tags tách riêng, không lẫn nhau', () => {
    assert.ok(raw.genres.includes('Action'), raw.genres.slice(0, 5).join(' | '));
    assert.ok(raw.genres.length > 0 && raw.tags.length > 0);
    assert.ok(raw.tags.length > raw.genres.length, 'NU có ~50 genre nhưng hàng nghìn tag');
  });

  it('ngôn ngữ là ngôn ngữ GỐC, không phải ngôn ngữ bản dịch', () => {
    assert.equal(raw.language, 'Chinese');
  });

  it('nhà xuất bản gốc', () => {
    assert.equal(raw.originalPublisher, 'Qidian');
  });

  it('mô tả giữ được ngắt đoạn', () => {
    assert.ok(raw.description !== null);
    assert.ok(raw.description.includes('\n\n'), 'phải giữ ngắt đoạn giữa các <p>');
  });

  /* ── Nối parser với extractor: giá trị thô phải bóc ra đúng số ── */

  it('status thô -> extractStatus cho đúng 2967 chương / 8 tập / Completed', () => {
    const status = extractStatus(raw.status);
    assert.equal(status.statusText, 'Completed');
    assert.equal(status.totalChapters, 2967);
    assert.equal(status.totalVolumes, 8);
  });

  it('rating thô -> extractRating cho đúng 4.0 / 117 phiếu', () => {
    const rating = extractRating(raw.rating);
    assert.equal(rating.rating, 4);
    assert.equal(rating.ratingsCount, 117);
  });

  it('chương mới nhất: nhãn + ngày + nhóm dịch', () => {
    assert.equal(raw.latestChapterLabel, 'c1045');
    assert.equal(extractChapterLabel(raw.latestChapterLabel).number, 1045);

    // Bảng ở TRANG SERIES có cột ngày (khác bảng trang chủ) -> nguồn cho last_chapter_at
    assert.ok(raw.latestChapterDate !== null, 'trang series phải có ngày phát hành');
    assert.match(raw.latestChapterDate, /^\d{2}\/\d{2}\/\d{2}$/, raw.latestChapterDate);
  });

  it('nhóm dịch lấy từ bảng phát hành', () => {
    assert.ok(raw.translationGroups.includes('Divine Dao Library'), raw.translationGroups.join(' | '));
  });
});

/**
 * Fixture QUAN TRỌNG NHẤT cho quyết định D2.
 * Novel này KHÔNG có token trạng thái nào — chỉ '269 Chapters'.
 */
describe('NovelUpdatesSeriesParser — the-villains-wishes (không có trạng thái)', () => {
  const { $, ctx } = loadFixture(
    SOURCE,
    'the-villains-wishes-backfire-and-the-protagonists-take-the-hit.html',
  );
  const raw = new NovelUpdatesSeriesParser().parse($, ctx);

  it('vẫn parse được dù thiếu trạng thái', () => {
    assert.equal(raw.externalId, 'the-villains-wishes-backfire-and-the-protagonists-take-the-hit');
    assert.ok(raw.title !== null);
  });

  it('lấy được số chương dù không có token trạng thái', () => {
    const status = extractStatus(raw.status);
    assert.equal(status.totalChapters, 269);
  });

  it('bằng chứng thực tế cho việc cần enum Unknown (D2)', () => {
    const status = extractStatus(raw.status);
    const KNOWN = ['Completed', 'Ongoing', 'Hiatus', 'Dropped'];
    const mapsToKnown = KNOWN.some(
      (token) => status.statusText?.toLowerCase().includes(token.toLowerCase()) === true,
    );
    assert.equal(
      mapsToKnown,
      false,
      'Nguồn không nói gì về trạng thái -> normalizer buộc phải dùng Unknown, ' +
        'không được gán bừa Ongoing',
    );
  });

  it('rating ít phiếu — ca cần Bayesian, không dùng trung bình thô', () => {
    const rating = extractRating(raw.rating);
    assert.equal(rating.rating, 4);
    assert.equal(rating.ratingsCount, 2);
  });
});

describe('NovelUpdatesLatestParser — trang chủ', () => {
  const { $, ctx } = loadFixture(SOURCE, 'latest-releases.html');
  const releases = new NovelUpdatesLatestParser().parse($, ctx);

  it('đọc được toàn bộ dòng của bảng render sẵn từ server', () => {
    assert.ok(releases.length > 50, `chỉ lấy được ${releases.length} dòng`);
  });

  it('mỗi dòng có đủ external_id, URL tuyệt đối và nhãn chương', () => {
    for (const release of releases) {
      assert.ok(release.externalId.length > 0);
      assert.ok(release.novelUrl.startsWith('https://www.novelupdates.com/series/'));
      assert.ok(release.chapterLabel !== null, `thiếu nhãn chương: ${release.externalId}`);
    }
  });

  it('nhãn chương bóc ra được số', () => {
    const first = releases[0];
    assert.ok(first !== undefined);
    assert.equal(first.chapterLabel, 'c1045');
    assert.equal(extractChapterLabel(first.chapterLabel).number, 1045);
  });

  /**
   * Ca hồi quy: bảng cắt ngắn tiêu đề dài trong TEXT nhưng giữ đầy đủ ở
   * attribute `title`. Đọc text sẽ lưu tiêu đề cụt kèm '...' vào database.
   */
  it('lấy tiêu đề ĐẦY ĐỦ từ attribute, không lấy text bị cắt', () => {
    const truncated = releases.filter((r) => r.novelTitle?.endsWith('...') === true);
    assert.equal(
      truncated.length,
      0,
      `${truncated.length} tiêu đề bị cắt: ${truncated.map((r) => r.novelTitle).join(' | ')}`,
    );

    const longTitle = releases.find((r) => (r.novelTitle?.length ?? 0) > 60);
    assert.ok(longTitle !== undefined, 'fixture phải có ít nhất một tiêu đề dài để kiểm chứng');
  });

  it('có nhóm dịch', () => {
    const withGroup = releases.filter((r) => r.translationGroup !== null);
    assert.ok(withGroup.length > releases.length * 0.8);
  });

  it('releasedAt là null — bảng trang chủ không có cột ngày', () => {
    assert.ok(releases.every((r) => r.releasedAt === null));
  });
});

describe('NovelUpdatesBrowseParser — series-ranking', () => {
  const { $, ctx } = loadFixture(SOURCE, 'series-ranking.html');
  const parser = new NovelUpdatesBrowseParser();
  const refs = parser.parse($, ctx);

  it('tìm được con trỏ novel', () => {
    assert.ok(refs.length > 10, `chỉ tìm được ${refs.length}`);
  });

  it('đã dedupe theo external_id', () => {
    const ids = refs.map((ref) => ref.externalId);
    assert.equal(new Set(ids).size, ids.length, 'không được có external_id trùng');
  });

  it('URL đã chuẩn hoá — không query, không fragment', () => {
    for (const ref of refs) {
      assert.ok(!ref.sourceUrl.includes('?'), ref.sourceUrl);
      assert.ok(!ref.sourceUrl.includes('#'), ref.sourceUrl);
      assert.ok(ref.sourceUrl.includes('/series/'));
    }
  });

  it('tìm được link phân trang', () => {
    const next = parser.nextPageUrl($, ctx);
    assert.ok(next === null || next.startsWith('https://www.novelupdates.com/'), next ?? '(null)');
  });
});
