import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapLanguage, mapNovelStatus } from '../../src/crawlers/novelupdates/mappings.js';
import { extractStatus } from '../../src/extractors/status.extractor.js';
import { NovelUpdatesSeriesParser } from '../../src/parsers/novelupdates/NovelUpdatesSeriesParser.js';
import { loadFixture } from '../helpers/fixtures.js';

describe('mapNovelStatus', () => {
  it('map các token cơ bản', () => {
    assert.equal(mapNovelStatus('Completed').status, 'Completed');
    assert.equal(mapNovelStatus('Ongoing').status, 'Ongoing');
    assert.equal(mapNovelStatus('Hiatus').status, 'Hiatus');
    assert.equal(mapNovelStatus('Dropped').status, 'Dropped');
  });

  it('map từ đồng nghĩa', () => {
    assert.equal(mapNovelStatus('Discontinued').status, 'Dropped');
    assert.equal(mapNovelStatus('Cancelled').status, 'Dropped');
    assert.equal(mapNovelStatus('Abandoned').status, 'Dropped');
    assert.equal(mapNovelStatus('Stalled').status, 'Hiatus');
    assert.equal(mapNovelStatus('Paused').status, 'Hiatus');
  });

  /** 'on hiatus' chứa cả 'hiatus'; nếu duyệt sai thứ tự có thể khớp nhầm. */
  it('token dài được ưu tiên hơn token ngắn', () => {
    assert.equal(mapNovelStatus('On Hiatus').status, 'Hiatus');
    assert.equal(mapNovelStatus('Currently Ongoing').status, 'Ongoing');
  });

  it('không phân biệt hoa thường và khoảng trắng thừa', () => {
    assert.equal(mapNovelStatus('  COMPLETED  ').status, 'Completed');
    assert.equal(mapNovelStatus('on   going').status, 'Ongoing');
  });

  it('nguồn im lặng -> Unknown, và KHÔNG tính là lỗi mapping', () => {
    assert.deepEqual(mapNovelStatus(null), { status: 'Unknown', unmapped: false });
    assert.deepEqual(mapNovelStatus(''), { status: 'Unknown', unmapped: false });
  });

  /**
   * Chuỗi chỉ có số lượng ('269 Chapters') nghĩa là nguồn KHÔNG khai báo trạng
   * thái — khác với token lạ. Không đánh dấu unmapped để log khỏi nhiễu.
   */
  it('chuỗi thuần số lượng -> Unknown, không đánh dấu unmapped', () => {
    assert.deepEqual(mapNovelStatus('269 Chapters'), { status: 'Unknown', unmapped: false });
    assert.deepEqual(mapNovelStatus('12 Volumes'), { status: 'Unknown', unmapped: false });
  });

  it('token thật sự lạ -> Unknown NHƯNG có đánh dấu để bổ sung mapping', () => {
    const result = mapNovelStatus('Perpetually Delayed');
    assert.equal(result.status, 'Unknown');
    assert.equal(result.unmapped, true);
  });

  it('KHÔNG BAO GIỜ đoán Ongoing khi không map được', () => {
    for (const input of ['???', 'xyz', '269 Chapters', null, '']) {
      assert.notEqual(
        mapNovelStatus(input).status,
        'Ongoing',
        `'${String(input)}' không được đoán thành Ongoing`,
      );
    }
  });
});

describe('mapLanguage — D3(b): lưu ngôn ngữ gốc, không lọc', () => {
  it('giữ nguyên giá trị nguồn cho', () => {
    assert.equal(mapLanguage('Chinese'), 'Chinese');
    assert.equal(mapLanguage('Korean'), 'Korean');
  });

  it('chuỗi rỗng -> null', () => {
    assert.equal(mapLanguage('   '), null);
    assert.equal(mapLanguage(null), null);
  });
});

/** Nối parser thật với mapping thật trên fixture thật. */
describe('parser + mapping trên fixture', () => {
  it('humanitys-great-sage -> Completed', () => {
    const { $, ctx } = loadFixture('novelupdates', 'humanitys-great-sage.html');
    const raw = new NovelUpdatesSeriesParser().parse($, ctx);
    const mapped = mapNovelStatus(extractStatus(raw.status).statusText);

    assert.equal(mapped.status, 'Completed');
    assert.equal(mapped.unmapped, false);
    assert.equal(mapLanguage(raw.language), 'Chinese');
  });

  it('the-villains-wishes -> Unknown (bằng chứng thực tế cho D2)', () => {
    const { $, ctx } = loadFixture(
      'novelupdates',
      'the-villains-wishes-backfire-and-the-protagonists-take-the-hit.html',
    );
    const raw = new NovelUpdatesSeriesParser().parse($, ctx);
    const mapped = mapNovelStatus(extractStatus(raw.status).statusText);

    assert.equal(
      mapped.status,
      'Unknown',
      'Nguồn chỉ ghi số chương, không có trạng thái -> phải là Unknown',
    );
    assert.equal(mapped.unmapped, false, 'không phải token lạ, chỉ là nguồn không khai báo');
  });
});
