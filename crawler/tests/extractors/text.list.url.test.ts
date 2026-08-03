import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cleanMultilineText,
  cleanText,
  stripLabel,
} from '../../src/extractors/text.extractor.js';
import { extractList } from '../../src/extractors/list.extractor.js';
import {
  canonicaliseUrl,
  extractPathSlug,
  isSameHost,
  toAbsoluteUrl,
} from '../../src/extractors/url.extractor.js';

describe('cleanText', () => {
  it('gom whitespace', () => {
    assert.equal(cleanText('  Shadow of   the Void \n '), 'Shadow of the Void');
  });

  /**
   * Ký tự vô hình làm hai chuỗi trông giống hệt nhau cho ra content_hash khác
   * nhau -> crawler báo "đã thay đổi" ở MỌI lần chạy.
   */
  it('bỏ ký tự vô hình', () => {
    assert.equal(cleanText('Shadow​of﻿the Void'), 'Shadowofthe Void');
    assert.equal(cleanText('a b'), 'a b', 'non-breaking space thành dấu cách thường');
  });

  it('giải mã HTML entity', () => {
    assert.equal(cleanText('Tom &amp; Jerry'), 'Tom & Jerry');
    assert.equal(cleanText('&quot;quoted&quot;'), '"quoted"');
  });

  it('coi placeholder là null', () => {
    for (const token of ['N/A', 'n/a', '-', '--', 'None', 'Unknown', '?']) {
      assert.equal(cleanText(token), null, `${token} phải là null`);
    }
  });

  it('rỗng -> null', () => {
    assert.equal(cleanText(''), null);
    assert.equal(cleanText('   '), null);
    assert.equal(cleanText(null), null);
  });
});

describe('cleanMultilineText', () => {
  it('giữ ngắt đoạn nhưng gom whitespace trong đoạn', () => {
    const result = cleanMultilineText('Đoạn   một.\n\n\nĐoạn    hai.');
    assert.equal(result, 'Đoạn một.\n\nĐoạn hai.');
  });
});

describe('stripLabel', () => {
  it('bỏ tiền tố nhãn', () => {
    assert.equal(stripLabel('Author: Aris Thorne', ['Author']), 'Aris Thorne');
    assert.equal(stripLabel('Type - Web Novel', ['Type']), 'Web Novel');
    assert.equal(stripLabel('Aris Thorne', ['Author']), 'Aris Thorne', 'không có nhãn thì giữ nguyên');
  });
});

describe('extractList', () => {
  it('tách theo dấu phẩy', () => {
    assert.deepEqual(extractList('Action, Drama , Fantasy'), ['Action', 'Drama', 'Fantasy']);
  });

  it('tách theo nhiều loại dấu', () => {
    assert.deepEqual(extractList('Action; Drama\nFantasy'), ['Action', 'Drama', 'Fantasy']);
  });

  /**
   * Thứ tự có ý nghĩa hiển thị: novel_genres.position quyết định genre nào được
   * render làm badge (HomeView lấy genres[0]). Dedupe phải giữ lần đầu tiên.
   */
  it('bỏ trùng nhưng giữ thứ tự lần xuất hiện đầu', () => {
    assert.deepEqual(extractList('Action, Drama, action, ACTION'), ['Action', 'Drama']);
  });

  it('nhận mảng đầu vào', () => {
    assert.deepEqual(extractList([' Action ', '', 'Drama', 'N/A']), ['Action', 'Drama']);
  });

  it('giới hạn số phần tử', () => {
    assert.equal(extractList('a,b,c,d,e', { limit: 3 }).length, 3);
  });

  it('rỗng / placeholder -> mảng rỗng', () => {
    assert.deepEqual(extractList('N/A'), []);
    assert.deepEqual(extractList(null), []);
  });
});

describe('toAbsoluteUrl', () => {
  const base = 'https://www.novelupdates.com/series/abc/';

  it('đổi link tương đối thành tuyệt đối', () => {
    assert.equal(toAbsoluteUrl('/series/xyz/', base), 'https://www.novelupdates.com/series/xyz/');
  });

  it('giữ nguyên link tuyệt đối', () => {
    assert.equal(toAbsoluteUrl('https://example.com/a', base), 'https://example.com/a');
  });

  it('chặn scheme nguy hiểm', () => {
    assert.equal(toAbsoluteUrl('javascript:alert(1)', base), null);
    assert.equal(toAbsoluteUrl('data:text/html,x', base), null);
  });
});

describe('canonicaliseUrl', () => {
  /**
   * external_id là nửa khoá chính của novel_sources. Không chuẩn hoá thì cùng
   * một novel sẽ sinh nhiều bản ghi mỗi lần crawl.
   */
  it('bỏ query, fragment, gạch chéo cuối', () => {
    const variants = [
      'https://www.novelupdates.com/series/abc/?utm_source=x',
      'https://www.novelupdates.com/series/abc#top',
      'https://www.novelupdates.com/series/abc/',
      'https://WWW.NovelUpdates.com/series/abc',
    ];
    const canonical = variants.map((url) => canonicaliseUrl(url));
    assert.equal(new Set(canonical).size, 1, `phải cho cùng 1 kết quả: ${canonical.join(' | ')}`);
  });
});

describe('extractPathSlug', () => {
  it('tách external_id từ URL series', () => {
    assert.equal(
      extractPathSlug('https://www.novelupdates.com/series/my-novel/', '/series/'),
      'my-novel',
    );
  });

  it('ổn định bất kể query/fragment/gạch chéo', () => {
    const ids = [
      'https://www.novelupdates.com/series/my-novel/',
      'https://www.novelupdates.com/series/my-novel',
      'https://www.novelupdates.com/series/my-novel/?ref=x',
    ].map((url) => extractPathSlug(url, '/series/'));
    assert.equal(new Set(ids).size, 1);
    assert.equal(ids[0], 'my-novel');
  });

  it('từ chối URL không đúng tiền tố', () => {
    assert.equal(extractPathSlug('https://www.novelupdates.com/about/', '/series/'), null);
  });
});

describe('isSameHost', () => {
  const base = 'https://www.novelupdates.com/';

  it('phân biệt được host để không crawl lạc sang site khác', () => {
    assert.equal(isSameHost('/series/abc', base), true);
    assert.equal(isSameHost('https://evil.example.com/x', base), false);
  });
});
