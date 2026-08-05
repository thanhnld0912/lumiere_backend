import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractParagraphs } from '../../src/extractors/content.extractor.js';

describe('extractParagraphs', () => {
  it('tách mỗi <p> thành một đoạn', () => {
    const result = extractParagraphs('<p>Đoạn một.</p>\n<p>Đoạn hai.</p><p>Đoạn ba.</p>');
    assert.deepEqual(result, ['Đoạn một.', 'Đoạn hai.', 'Đoạn ba.']);
  });

  it('bỏ thẻ inline nhưng giữ chữ', () => {
    const result = extractParagraphs('<p>Chữ <em>nghiêng</em> và <strong>đậm</strong>.</p>');
    assert.deepEqual(result, ['Chữ nghiêng và đậm.']);
  });

  it('giải mã HTML entity', () => {
    assert.deepEqual(extractParagraphs('<p>Tom &amp; Jerry &quot;bạn&quot;</p>'), [
      'Tom & Jerry "bạn"',
    ]);
  });

  it('bỏ đoạn rỗng và đoạn chỉ có &nbsp;', () => {
    const result = extractParagraphs('<p>Có chữ.</p><p> </p><p></p><p>Cũng có chữ.</p>');
    assert.deepEqual(result, ['Có chữ.', 'Cũng có chữ.']);
  });

  it('bỏ đoạn chỉ toàn ký tự trang trí', () => {
    const result = extractParagraphs('<p>Trước.</p><p>***</p><p>———</p><p>Sau.</p>');
    assert.deepEqual(result, ['Trước.', 'Sau.']);
  });

  /**
   * script/style phải bị vứt CẢ NỘI DUNG, không chỉ bỏ thẻ — nếu không mã
   * JavaScript sẽ lọt vào giữa truyện.
   */
  it('vứt hẳn nội dung script/style', () => {
    const result = extractParagraphs(
      '<p>Chữ.</p><script>var x = "đừng hiện ra";</script><style>.a{color:red}</style><p>Chữ nữa.</p>',
    );
    assert.deepEqual(result, ['Chữ.', 'Chữ nữa.']);
  });

  it('<br> là xuống dòng trong CÙNG một đoạn, không tách đoạn mới', () => {
    const result = extractParagraphs('<p>Dòng một<br>Dòng hai</p>');
    assert.equal(result.length, 1);
    assert.ok(result[0]?.includes('Dòng một'));
    assert.ok(result[0]?.includes('Dòng hai'));
  });

  it('xử lý được nội dung dùng <div> thay vì <p>', () => {
    assert.deepEqual(extractParagraphs('<div>Một.</div><div>Hai.</div>'), ['Một.', 'Hai.']);
  });

  /* ── Bỏ tiêu đề lặp ở đầu — đo trên dữ liệu thật ScribbleHub ── */

  it('bỏ dòng đầu khi nó trùng tiêu đề chương', () => {
    const result = extractParagraphs(
      '<p>Chapter 1: So I Died Today</p><p>So I died today.</p><p>Which was odd.</p>',
      { dropTitleLine: 'So I died today' },
    );
    assert.deepEqual(result, ['So I died today.', 'Which was odd.']);
  });

  it("bỏ dòng đầu dạng 'Chapter 2' dù không kèm tên", () => {
    const result = extractParagraphs('<p>Chapter 2</p><p>Nội dung thật.</p>', {
      dropTitleLine: 'Second Chances',
    });
    assert.deepEqual(result, ['Nội dung thật.']);
  });

  it('không phân biệt hoa thường ở dòng tiêu đề', () => {
    assert.deepEqual(extractParagraphs('<p>chapter 4</p><p>Chữ.</p>'), ['Chữ.']);
  });

  /** Đoạn mở đầu hợp lệ mà tình cờ nhắc tới chương thì KHÔNG được bỏ. */
  it('KHÔNG bỏ đoạn mở đầu là văn bản thật', () => {
    const result = extractParagraphs(
      '<p>Chapter 3 of my life had begun, and it hurt.</p><p>Tiếp theo.</p>',
      { dropTitleLine: 'Old man' },
    );
    assert.equal(result.length, 2);
    assert.ok(result[0]?.startsWith('Chapter 3 of my life'));
  });

  it('KHÔNG bỏ dòng duy nhất — chương một đoạn vẫn phải còn nội dung', () => {
    assert.deepEqual(extractParagraphs('<p>Chapter 5</p>'), ['Chapter 5']);
  });

  it('đầu vào rỗng/null -> mảng rỗng', () => {
    for (const input of [null, undefined, '', '<p></p>']) {
      assert.deepEqual(extractParagraphs(input), []);
    }
  });
});
