export class QueryLibraryDto {
  tab: 'creative' | 'upload' = 'creative';
  type: 'all' | 'image' | 'video' | 'audio' = 'all';
  favorite?: string; // 'true' | undefined — query param luôn là string
}