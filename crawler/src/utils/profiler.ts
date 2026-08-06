/**
 * Đo thời gian theo GIAI ĐOẠN cho một lần chạy.
 *
 * Vì sao cần: log mức debug cho biết chuyện gì xảy ra, nhưng không cho biết
 * thời gian ĐI ĐÂU. Một job 30 phút với 900 dòng log trông y hệt nhau dù nút
 * thắt nằm ở mạng, ở database, hay ở chỗ chờ rate limit.
 *
 * Là SINGLETON có chủ đích: crawler là tiến trình chạy một lần rồi thoát, và
 * luồn một đối tượng profiler qua mọi chữ ký hàm chỉ để đo đạc sẽ làm bẩn ranh
 * giới giữa các tầng — đúng thứ kiến trúc này cố tránh.
 *
 * Chi phí: một `performance.now()` cho mỗi lần gọi. Không đáng kể so với một
 * request HTTP.
 */

interface Stage {
  totalMs: number;
  calls: number;
}

class StageProfiler {
  private readonly stages = new Map<string, Stage>();
  private startedAt = performance.now();

  reset(): void {
    this.stages.clear();
    this.startedAt = performance.now();
  }

  /** Bọc một đoạn async và cộng dồn thời gian vào `stage`. */
  async time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const from = performance.now();
    try {
      return await fn();
    } finally {
      this.add(stage, performance.now() - from);
    }
  }

  add(stage: string, ms: number): void {
    const current = this.stages.get(stage) ?? { totalMs: 0, calls: 0 };
    current.totalMs += ms;
    current.calls += 1;
    this.stages.set(stage, current);
  }

  get elapsedMs(): number {
    return performance.now() - this.startedAt;
  }

  /**
   * Bảng kết quả, sắp theo thời gian giảm dần.
   *
   * `%` tính trên TỔNG thời gian chạy chứ không phải tổng các giai đoạn: các
   * giai đoạn lồng nhau (VD `followup:refresh` chứa `refresh:contents`) nên
   * cộng lại sẽ vượt 100%. Lấy tổng thời gian thật làm mẫu số thì mỗi dòng đọc
   * được là "chiếm bao nhiêu phần của cả lần chạy" — đó mới là câu hỏi cần trả lời.
   */
  report(): { stage: string; ms: number; calls: number; pct: number }[] {
    const elapsed = Math.max(1, this.elapsedMs);
    return [...this.stages.entries()]
      .map(([stage, value]) => ({
        stage,
        ms: Math.round(value.totalMs),
        calls: value.calls,
        pct: Math.round((value.totalMs / elapsed) * 1000) / 10,
      }))
      .sort((a, b) => b.ms - a.ms);
  }

  /** In bảng ra stdout. Gọi ở cuối CLI. */
  print(): void {
    const rows = this.report();
    if (rows.length === 0) return;

    console.log('\n  Thời gian theo giai đoạn');
    console.log('  ────────────────────────────────┬──────────┬───────┬───────');
    console.log('  giai đoạn                       │       ms │  lượt │     %');
    console.log('  ────────────────────────────────┼──────────┼───────┼───────');
    for (const row of rows) {
      console.log(
        `  ${row.stage.padEnd(30)} │ ${String(row.ms).padStart(8)} │ ` +
          `${String(row.calls).padStart(5)} │ ${String(row.pct).padStart(5)}`,
      );
    }
    console.log(`  ────────────────────────────────┴──────────┴───────┴───────`);
    console.log(`  tổng: ${Math.round(this.elapsedMs)}ms\n`);
  }
}

export const profiler = new StageProfiler();
