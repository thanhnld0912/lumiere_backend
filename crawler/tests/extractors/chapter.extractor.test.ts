import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDisplayTitle,
  extractChapterLabel,
} from '../../src/extractors/chapter.extractor.js';

/**
 * Nhãn chương là phần nhiều biến thể nhất của toàn bộ crawler, và cũng là phần
 * duy nhất ảnh hưởng trực tiếp tới `sort_index` — tức thứ tự đọc.
 * Sai ở đây thì người dùng bấm "chương sau" ra chương không đúng.
 */
describe('extractChapterLabel', () => {
  it('dạng ngắn: c243', () => {
    const result = extractChapterLabel('c243');
    assert.equal(result.number, 243);
    assert.equal(result.volumeNumber, null);
    assert.equal(result.partNumber, null);
    assert.equal(result.isExtra, false);
    assert.equal(result.title, '');
  });

  it('dạng đầy đủ: Chapter 243', () => {
    assert.equal(extractChapterLabel('Chapter 243').number, 243);
    assert.equal(extractChapterLabel('chapter 243').number, 243);
    assert.equal(extractChapterLabel('ch.243').number, 243);
    assert.equal(extractChapterLabel('c.243').number, 243);
  });

  it('có tên riêng: Chapter 243: Return', () => {
    const result = extractChapterLabel('Chapter 243: Return');
    assert.equal(result.number, 243);
    assert.equal(result.title, 'Return');
  });

  it('có tập: v2c15', () => {
    const result = extractChapterLabel('v2c15');
    assert.equal(result.volumeNumber, 2);
    assert.equal(result.number, 15);
  });

  it('có tập dạng dài: Vol 5 Chapter 243', () => {
    const result = extractChapterLabel('Vol 5 Chapter 243');
    assert.equal(result.volumeNumber, 5);
    assert.equal(result.number, 243);
    assert.equal(result.title, '');
  });

  it('tập + chương + tên: Vol 5 Chapter 243: Return', () => {
    const result = extractChapterLabel('Vol 5 Chapter 243: Return');
    assert.equal(result.volumeNumber, 5);
    assert.equal(result.number, 243);
    assert.equal(result.title, 'Return');
  });

  it('thập phân thành part: c243.5', () => {
    const result = extractChapterLabel('c243.5');
    assert.equal(result.number, 243);
    assert.equal(result.partNumber, 5);
  });

  it('part tường minh: c243 part2', () => {
    const result = extractChapterLabel('c243 part2');
    assert.equal(result.number, 243);
    assert.equal(result.partNumber, 2);
  });

  it('part + tên: Chapter 243 Part 2: The End', () => {
    const result = extractChapterLabel('Chapter 243 Part 2: The End');
    assert.equal(result.number, 243);
    assert.equal(result.partNumber, 2);
    assert.equal(result.title, 'The End');
  });

  it('chương phụ: Extra Chapter 12', () => {
    const result = extractChapterLabel('Extra Chapter 12');
    assert.equal(result.isExtra, true);
    assert.equal(result.number, 12);
  });

  it('side story dạng ss1', () => {
    const result = extractChapterLabel('ss1');
    assert.equal(result.isExtra, true);
    assert.equal(result.number, 1);
  });

  it('khoảng chương: c100-102', () => {
    const result = extractChapterLabel('c100-102');
    assert.equal(result.number, 100);
    assert.equal(result.rangeEnd, 102);
  });

  it('không có số: Prologue', () => {
    const result = extractChapterLabel('Prologue');
    assert.equal(result.isExtra, true);
    assert.equal(result.number, null);
  });

  it('Interlude 3', () => {
    const result = extractChapterLabel('Interlude 3');
    assert.equal(result.isExtra, true);
    assert.equal(result.number, 3);
  });

  it('số trần: 243: Return', () => {
    const result = extractChapterLabel('243: Return');
    assert.equal(result.number, 243);
    assert.equal(result.title, 'Return');
  });

  /**
   * Ca hồi quy quan trọng nhất của file này.
   *
   * Chữ 'Special' nằm trong TÊN chương, không phải dấu hiệu chương phụ. Nhận
   * nhầm sẽ khiến isExtra = true -> sort_index +1 -> chương này bị xếp sai chỗ.
   */
  it('KHÔNG nhận nhầm chương phụ khi từ khoá nằm trong tên', () => {
    const special = extractChapterLabel('Chapter 5: Special Delivery');
    assert.equal(special.isExtra, false, "'Special' trong tên không phải chương phụ");
    assert.equal(special.number, 5);
    assert.equal(special.title, 'Special Delivery');

    const bonus = extractChapterLabel('Chapter 88: Bonus Round');
    assert.equal(bonus.isExtra, false);
    assert.equal(bonus.number, 88);

    const extraInTitle = extractChapterLabel('c12: Extra Credit');
    assert.equal(extraInTitle.isExtra, false);
    assert.equal(extraInTitle.number, 12);
  });

  it('không nhận nhầm chữ cái giữa từ thành ký hiệu chương', () => {
    // 'Assassin' chứa 'ss' nhưng không phải side story
    const result = extractChapterLabel('Chapter 7: The Assassin');
    assert.equal(result.isExtra, false);
    assert.equal(result.number, 7);
    assert.equal(result.title, 'The Assassin');
  });

  it('giữ nguyên chuỗi gốc để re-parse sau', () => {
    assert.equal(extractChapterLabel('  Vol 5 Chapter 243: Return  ').raw, 'Vol 5 Chapter 243: Return');
  });

  it('đầu vào rỗng / null', () => {
    for (const input of [null, undefined, '', '   ', 'N/A']) {
      const result = extractChapterLabel(input);
      assert.equal(result.number, null);
      assert.equal(result.isExtra, false);
    }
  });
});

describe('buildDisplayTitle', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['c243', 'Chapter 243'],
    ['Chapter 243: Return', 'Chapter 243: Return'],
    ['v5c243', 'Vol 5 Chapter 243'],
    ['c243 part2', 'Chapter 243 Part 2'],
    ['Extra Chapter 12', 'Extra Chapter 12'],
    ['c100-102', 'Chapter 100-102'],
    ['Prologue', 'Prologue'],
  ];

  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      assert.equal(buildDisplayTitle(extractChapterLabel(input)), expected);
    });
  }

  it('KHÔNG bịa tên khi nguồn không đặt tên', () => {
    const result = buildDisplayTitle(extractChapterLabel('c243'));
    assert.equal(result, 'Chapter 243');
    assert.ok(!result.includes(':'), 'không được thêm phần tên trống');
  });
});
