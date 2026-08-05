import type { SourceId } from '../../core/types.js';
import { novelUpdatesConfig } from './novelupdates.config.js';
import { scribbleHubConfig } from './scribblehub.config.js';
import type { SourceConfig } from './types.js';

/**
 * Danh bạ cấu hình nguồn.
 *
 * Thêm nguồn mới = thêm đúng MỘT dòng vào đây + một file config. Không file nào
 * khác phải sửa.
 */
const configs: readonly SourceConfig[] = [
  scribbleHubConfig,
  novelUpdatesConfig,
  // RoyalRoad, Foxaholic… thêm vào đây
];

export const SOURCE_CONFIGS: ReadonlyMap<SourceId, SourceConfig> = new Map(
  configs.map((config) => [config.id, config]),
);

export function getSourceConfig(sourceId: SourceId): SourceConfig | undefined {
  return SOURCE_CONFIGS.get(sourceId);
}

export function listEnabledSources(): readonly SourceConfig[] {
  return configs.filter((config) => config.enabled);
}

export { novelUpdatesConfig, scribbleHubConfig };
export type { NovelUpdatesConfig } from './novelupdates.config.js';
export type { ScribbleHubConfig } from './scribblehub.config.js';
export type { HttpConfig, PolitenessConfig, SourceConfig } from './types.js';
