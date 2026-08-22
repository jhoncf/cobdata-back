import { Module } from '@nestjs/common';
import { LigueLeadController } from './liguelead.controller';
import { LigueLeadService } from './liguelead.service';
@Module({ controllers: [LigueLeadController], providers: [LigueLeadService] })
export class LigueLeadModule {}
