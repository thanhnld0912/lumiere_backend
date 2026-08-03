import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDate } from '../../src/extractors/date.extractor.js';

/**
 * `now` cố định -> test tất định.
 * Nếu parseDate gọi new Date() bên trong thì '2 days ago' không thể test được.
 */
const NOW = new Date('2024-08-15T12:00:00.000Z');

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('parseDate — nhãn tương đối', () => {
  it('giờ / ngày / tuần', () => {
    assert.equal(parseDate('2 hours ago', NOW)?.getTime(), NOW.getTime() - 2 * HOUR);
    assert.equal(parseDate('3 days ago', NOW)?.getTime(), NOW.getTime() - 3 * DAY);
    assert.equal(parseDate('1 week ago', NOW)?.getTime(), NOW.getTime() - 7 * DAY);
  });

  it("dạng 'an hour ago' / 'a day ago' hiểu là 1", () => {
    assert.equal(parseDate('an hour ago', NOW)?.getTime(), NOW.getTime() - HOUR);
    assert.equal(parseDate('a day ago', NOW)?.getTime(), NOW.getTime() - DAY);
  });

  it('viết tắt', () => {
    assert.equal(parseDate('5 mins ago', NOW)?.getTime(), NOW.getTime() - 5 * 60_000);
    assert.equal(parseDate('2 hrs ago', NOW)?.getTime(), NOW.getTime() - 2 * HOUR);
  });

  it('today / yesterday', () => {
    assert.equal(parseDate('today', NOW)?.getTime(), NOW.getTime());
    assert.equal(parseDate('yesterday', NOW)?.getTime(), NOW.getTime() - DAY);
  });
});

describe('parseDate — ngày tuyệt đối', () => {
  it('MM/DD/YY (mặc định, NovelUpdates là site Mỹ)', () => {
    const result = parseDate('10/12/23', NOW);
    assert.equal(result?.getUTCFullYear(), 2023);
    assert.equal(result?.getUTCMonth(), 9, 'tháng 10');
    assert.equal(result?.getUTCDate(), 12);
  });

  it('DD/MM/YY khi khai báo dayFirst', () => {
    const result = parseDate('10/12/23', NOW, { dayFirst: true });
    assert.equal(result?.getUTCMonth(), 11, 'tháng 12');
    assert.equal(result?.getUTCDate(), 10);
  });

  /** '25/12/23' không thể là tháng 25 -> tự đảo, cứu được dữ liệu thay vì trả null. */
  it('tự sửa khi tháng bất khả thi', () => {
    const result = parseDate('25/12/23', NOW);
    assert.equal(result?.getUTCMonth(), 11, 'tháng 12');
    assert.equal(result?.getUTCDate(), 25);
  });

  it('tên tháng', () => {
    const result = parseDate('Oct 12, 2023', NOW);
    assert.equal(result?.getUTCFullYear(), 2023);
    assert.equal(result?.getUTCMonth(), 9);
    assert.equal(result?.getUTCDate(), 12);
  });

  it('ISO', () => {
    assert.equal(parseDate('2023-10-12', NOW)?.toISOString().slice(0, 10), '2023-10-12');
  });

  /**
   * Cột là timestamptz, Postgres lưu UTC. Dùng giờ địa phương sẽ khiến ngày
   * lệch một đơn vị giữa máy dev và runner CI (chạy UTC).
   */
  it('dựng ngày ở UTC, không theo giờ địa phương', () => {
    const result = parseDate('Oct 12, 2023', NOW);
    assert.equal(result?.toISOString(), '2023-10-12T00:00:00.000Z');
  });

  it('từ chối ngày không tồn tại', () => {
    assert.equal(parseDate('02/31/23', NOW), null, '31 tháng 2 không tồn tại');
  });
});

describe('parseDate — đầu vào hỏng', () => {
  it('trả null thay vì Invalid Date', () => {
    for (const input of [null, undefined, '', '   ', 'N/A', 'không phải ngày']) {
      const result = parseDate(input, NOW);
      assert.equal(result, null, `${String(input)} phải trả null`);
    }
  });
});
