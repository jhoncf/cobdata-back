import { ApiProperty } from '@nestjs/swagger';
import { MissingField } from '../adapters/types';

/**
 * Response DTO for the preflight validation endpoint.
 * Lists missing or invalid fields without calling the provider.
 */
export class PreflightResponseDto {
  @ApiProperty({
    description: 'List of missing or invalid fields',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  })
  missingFields!: MissingField[];

  @ApiProperty({
    description: 'Whether all validations passed',
  })
  valid!: boolean;

  static fromMissingFields(fields: MissingField[]): PreflightResponseDto {
    const dto = new PreflightResponseDto();
    dto.missingFields = fields;
    dto.valid = fields.length === 0;
    return dto;
  }
}
