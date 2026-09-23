import { Module } from '@nestjs/common';
import { EmailModule } from '../common/email';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplatesService } from './email-templates.service';
@Module({ imports: [EmailModule], controllers: [EmailTemplatesController], providers: [EmailTemplatesService], exports: [EmailTemplatesService] })
export class EmailTemplatesModule {}
