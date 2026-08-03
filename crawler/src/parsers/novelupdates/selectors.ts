/**
 * Selector CSS của NovelUpdates — TẬP TRUNG MỘT CHỖ.
 *
 * Khi NU đổi layout, đây là file DUY NHẤT phải sửa. Logic phân tích chuỗi nằm ở
 * `extractors/` và không đụng tới; logic ánh xạ nằm ở normalizer.
 *
 * ⚠️ Mọi selector dưới đây được XÁC MINH trên fixture thật trong
 * tests/fixtures/novelupdates/, không phải suy đoán.
 */

/** Trang chi tiết series — /series/<slug>/ */
export const SERIES = {
  title: '.seriestitlenu',
  coverImage: '.seriesimg img',
  /** Nhiều đoạn <p>. Dùng cleanMultilineText để giữ ngắt đoạn. */
  description: '#editdescription',
  /** Tên khác, phân tách bằng <br>. VD 'The Great Sage of Humanity<br>人道大圣' */
  associatedNames: '#editassociated',
  /** VD '8 volumes / 2967 Chapters (Completed)' */
  status: '#editstatus',
  type: '#showtype a',
  /** Ngôn ngữ GỐC (Chinese/Korean/…), KHÔNG phải ngôn ngữ bản dịch. */
  language: '#showlang a',
  originalPublisher: '#showopublisher',
  /** Nhiều thẻ <a>, phân tách bằng <br>. */
  authors: '#showauthors a',
  artists: '#showartists a',
  genres: '#seriesgenre a',
  tags: '#showtags a',
  /** VD '(4.0 / 5.0, 117 votes)' */
  rating: '.uvotes',

  /** Bảng phát hành: Date | Group | Release. CÓ ngày, khác bảng ở trang chủ. */
  releaseRows: '#myTable tbody tr',
  releaseDateCell: 'td:nth-child(1)',
  releaseGroupCell: 'td:nth-child(2) a',
  /** Nhãn chương nằm ở attribute `title` của <span>, VD <span title="c1045">. */
  releaseChapterCell: 'td:nth-child(3) span',
} as const;

/**
 * Trang chủ — CHÍNH LÀ feed latest releases.
 *
 * Bảng: Title | Release | Group. KHÔNG có cột ngày (khác bảng ở trang series).
 */
export const LATEST = {
  rows: 'table#myTable.tablesorter tbody tr',
  seriesCell: 'td:nth-child(1) a',
  chapterCell: 'td:nth-child(2) span',
  groupCell: 'td:nth-child(3) a',
} as const;

/** Trang danh mục / xếp hạng — nguồn cho mode `discover`. */
export const BROWSE = {
  seriesLinks: 'a[href*="/series/"]',
  pagination: '.digg_pagination',
  nextPage: '.digg_pagination a.next_page, .digg_pagination a.page-numbers',
} as const;

/**
 * Attribute chứa giá trị ĐẦY ĐỦ khi text hiển thị bị cắt ngắn.
 *
 * Bảng latest releases cắt tiêu đề dài thành 'The Imperial Consort Was Born
 * With a Seductive...' nhưng attribute `title` giữ nguyên bản đầy đủ. Đọc text
 * thay vì attribute sẽ lưu tiêu đề cụt vào database.
 */
export const FULL_VALUE_ATTRIBUTE = 'title';
