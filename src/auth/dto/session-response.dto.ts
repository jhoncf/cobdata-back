export class SessionResponseDto {
  id!: string;
  userAgent!: string | null;
  ipAddress!: string | null;
  createdAt!: Date;
  isCurrent!: boolean;
}
