import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractRating } from '../../src/extractors/rating.extractor.js';
import { extractStatus } from '../../src/extractors/status.extractor.js';
import {
  parseCompactNumber,
  parseFloatSafe,
  parseIntSafe,
} from '../../src/extractors/number.extractor.js';

describe('parseIntSafe', () => {
  it('xử lý dấu phân cách hàng nghìn', () => {
    // parseInt('1,234') tra ve 1 — day la ly do phai co ham rieng
    assert.equal(parseIntSafe('1,234 votes'), 1234);
    assert.equal(parseIntSafe('12 345'), 12345);
    assert.notEqual(parseIntSafe('1,234'), 1);
  });

  it('trả null thay vì NaN', () => {
    assert.equal(parseIntSafe('abc'), null);
    assert.equal(parseIntSafe(''), null);
    assert.equal(parseIntSafe(null), null);
  });
});

describe('parseFloatSafe', () => {
  it('thập phân kiểu Mỹ và châu Âu', () => {
    assert.equal(parseFloatSafe('4.2 / 5'), 4.2);
    assert.equal(parseFloatSafe('4,2'), 4.2, 'dấu phẩy thập phân');
    assert.equal(parseFloatSafe('1,234.5'), 1234.5, 'phẩy = hàng nghìn khi có dấu chấm');
  });
});

describe('parseCompactNumber', () => {
  it('rút gọn k/M/B', () => {
    assert.equal(parseCompactNumber('12.4k'), 12400);
    assert.equal(parseCompactNumber('2.8M'), 2800000);
    assert.equal(parseCompactNumber('980k'), 980000);
    assert.equal(parseCompactNumber('1234'), 1234);
  });
});

describe('extractRating', () => {
  it('dạng đầy đủ của NovelUpdates', () => {
    const result = extractRating('4.2 / 5 from 1,234 ratings');
    assert.equal(result.rating, 4.2);
    assert.equal(result.ratingsCount, 1234);
  });

  it('dạng trong ngoặc', () => {
    const result = extractRating('(4.2 / 5.0, 1234 votes)');
    assert.equal(result.rating, 4.2);
    assert.equal(result.ratingsCount, 1234);
  });

  it('không có thang -> giả định thang 5', () => {
    assert.equal(extractRating('4.2').rating, 4.2);
  });

  /**
   * Cột là numeric(3,2) với CHECK (rating BETWEEN 0 AND 5).
   * Nguồn dùng thang 10 mà không quy đổi thì MỌI insert sẽ vi phạm CHECK.
   */
  it('quy đổi thang 10 về thang 5', () => {
    const result = extractRating('8.4 / 10');
    assert.equal(result.rating, 4.2);
    assert.equal(result.detectedScale, 10);
  });

  it('luôn nằm trong [0, 5] để không phá CHECK constraint', () => {
    for (const input of ['9.9', '-3', '100 / 5', '4.2 / 5']) {
      const { rating } = extractRating(input);
      if (rating !== null) {
        assert.ok(rating >= 0 && rating <= 5, `${input} -> ${rating} phải trong [0,5]`);
      }
    }
  });

  it('làm tròn 2 chữ số cho khớp numeric(3,2)', () => {
    const { rating } = extractRating('8.333 / 10');
    assert.ok(rating !== null);
    const decimals = String(rating).split('.')[1] ?? '';
    assert.ok(decimals.length <= 2, `${rating} có quá 2 chữ số thập phân`);
  });

  it('đầu vào rỗng', () => {
    assert.equal(extractRating(null).rating, null);
    assert.equal(extractRating('N/A').rating, null);
  });
});

describe('extractStatus', () => {
  it('chỉ có trạng thái', () => {
    assert.equal(extractStatus('Completed').statusText, 'Completed');
    assert.equal(extractStatus('Ongoing').statusText, 'Ongoing');
    assert.equal(extractStatus('Hiatus').statusText, 'Hiatus');
  });

  it('trạng thái trong ngoặc + số chương', () => {
    const result = extractStatus('243 Chapters (Completed)');
    assert.equal(result.statusText, 'Completed');
    assert.equal(result.totalChapters, 243);
  });

  it('số chương trong ngoặc', () => {
    const result = extractStatus('Completed (243 chapters)');
    assert.equal(result.totalChapters, 243);
  });

  it('số tập', () => {
    const result = extractStatus('12 Volumes (Completed)');
    assert.equal(result.totalVolumes, 12);
    assert.equal(result.statusText, 'Completed');
  });

  it('số chương có dấu phẩy', () => {
    assert.equal(extractStatus('1,234 Chapters (Ongoing)').totalChapters, 1234);
  });

  /**
   * Extractor CỐ Ý không map sang enum novel_status — đó là việc của normalizer
   * với bảng mapping riêng của từng nguồn. Ở đây chỉ giữ nguyên token.
   */
  it('không map sang enum, giữ nguyên token của nguồn', () => {
    assert.equal(extractStatus('Dropped').statusText, 'Dropped');
    assert.equal(extractStatus('Discontinued').statusText, 'Discontinued');
  });

  it('token lạ vẫn trả về để normalizer ghi log, không mất thông tin', () => {
    const result = extractStatus('Some Unusual Status');
    assert.notEqual(result.statusText, null);
  });

  it('đầu vào rỗng', () => {
    assert.equal(extractStatus(null).statusText, null);
    assert.equal(extractStatus('N/A').statusText, null);
  });
});
