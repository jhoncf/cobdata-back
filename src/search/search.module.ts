import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProvidersModule } from '../providers/providers.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [PrismaModule, ProvidersModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
