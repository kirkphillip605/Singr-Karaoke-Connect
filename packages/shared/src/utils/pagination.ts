export interface PaginationParams {
  limit: number;
  offset: number;
  cursor?: string;
}

export interface PaginationInfo {
  total?: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextCursor?: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}

export function createPaginationInfo(
  total: number | undefined,
  limit: number,
  offset: number,
  dataLength: number
): PaginationInfo {
  return {
    total,
    limit,
    offset,
    hasMore: dataLength === limit,
    nextCursor: dataLength === limit ? (offset + limit).toString() : null,
  };
}

export function parsePaginationParams(
  query: Record<string, unknown>
): PaginationParams {
  const limit = Math.min(
    Math.max(1, parseInt(String(query.limit || 20), 10)),
    100
  );
  const offset = Math.max(0, parseInt(String(query.offset || 0), 10));
  const cursor = query.cursor ? String(query.cursor) : undefined;

  return { limit, offset, cursor };
}
