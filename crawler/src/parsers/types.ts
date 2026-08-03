import type { CheerioCrawlingContext } from '@crawlee/cheerio';

/**
 * Kiểu của `$` mà Crawlee đưa vào requestHandler.
 *
 * ⚠️ CỐ Ý suy ra từ chính Crawlee thay vì `import type { CheerioAPI } from 'cheerio'`.
 *
 * Lý do: gói `cheerio` xuất bản cả bản CJS (`cheerio/lib/load`) lẫn ESM
 * (`cheerio/lib/esm/load`) với hai file khai báo RIÊNG. Crawlee được biên dịch ở
 * chế độ CJS nên `$` của nó mang kiểu từ `lib/load`, còn package này là ESM
 * (`moduleResolution: NodeNext`) nên `import from 'cheerio'` lại ra `lib/esm/load`.
 * TypeScript coi hai kiểu đó là KHÁC NHAU — kể cả khi chỉ có đúng một bản cheerio
 * được cài — và báo lỗi kiểu "Types have separate declarations of a private
 * property 'cbs'".
 *
 * Suy kiểu từ `CheerioCrawlingContext['$']` thì parser luôn khớp chính xác thứ
 * Crawlee truyền vào, bất kể sau này cheerio đổi cách đóng gói.
 */
export type CheerioRoot = CheerioCrawlingContext['$'];
