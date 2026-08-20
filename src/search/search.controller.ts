import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchResultDto } from './dto/search-result.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { Request } from 'express';

@ApiTags('Search')
@ApiBearerAuth('bearer')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Global search',
    description:
      'Search across creditors, wallets and contracts with a single query',
  })
  @ApiResponse({
    status: 200,
    description: 'Search results grouped by category',
    type: SearchResultDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Query parameter "q" must be between 3 and 100 characters',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async search(
    @Query() query: SearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SearchResultDto> {
    const userScopes = (req as any).userScopes as string[] | undefined;
    return this.searchService.search(query.q, user, userScopes);
  }
}
