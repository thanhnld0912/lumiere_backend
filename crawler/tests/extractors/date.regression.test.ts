import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDate } from '../../src/extractors/date.extractor.js';

const NOW = new Date('2024-08-15T12:00:00.000Z');

/**
 * Hồi quy cho bug tìm ra ở Phase 3.
 *
 * TRIỆU CHỨNG: parseDate('02/31/23') trả về 2023-03-02T17:00:00.000Z
 * NGUYÊN NHÂN: parseSlashDate từ chối đúng ngày 31/02 và trả null, nhưng code
 *              rơi xuống fallback `new Date(text)`. Fallback đó (a) cuộn ngày
 *              không tồn tại sang tháng sau, và (b) parse theo GIỜ ĐỊA PHƯƠNG,
 *              nên kết quả lệch giữa máy dev (UTC+7) và runner CI (UTC).
 * CÁCH SỬA  : chuỗi khớp định dạng ta xử lý thì trả kết quả của parser đó NGAY,
 *              không fallback. Fallback chỉ còn nhận ISO 8601.
 */
describe('hồi quy: fallback new Date() không được nuốt ngày sai', () => {
  it('ngày không tồn tại phải là null, không được cuộn sang tháng sau', () => {
    for (const input of ['02/31/23', '02/30/24', '04/31/23', '06/31/23']) {
      assert.equal(parseDate(input, NOW), null, `${input} phải trả null`);
    }
  });

  it('không phụ thuộc múi giờ máy chạy', () => {
    // Mọi ngày tuyệt đối phải rơi đúng 00:00 UTC. Nếu fallback dùng giờ địa
    // phương thì giá trị này sẽ là 17:00 (UTC+7) hoặc lệch khác.
    for (const input of ['10/12/23', 'Oct 12, 2023', '2023-10-12']) {
      const result = parseDate(input, NOW);
      assert.ok(result !== null, `${input} phải parse được`);
      assert.equal(
        result.toISOString().slice(11),
        '00:00:00.000Z',
        `${input} -> ${result.toISOString()} phải là nửa đêm UTC`,
      );
    }
  });

  it('chuỗi rác không được thành ngày qua fallback', () => {
    for (const input of ['Dec', '2023', 'March', 'chapter 5', '12-31']) {
      assert.equal(parseDate(input, NOW), null, `${input} phải trả null`);
    }
  });
});
