export class PaginationMeta {
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}

export class PaginatedResponse<T> {
  data!: T[];
  meta!: PaginationMeta;
}
