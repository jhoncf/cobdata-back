import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { GlobalExceptionFilter } from './common/filters';
import { TransformInterceptor } from './common/interceptors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  app.use(cookieParser());

  // CORS — allow front-end origin with credentials (cookies)
  const corsOrigin = configService.get<string>('CORS_ORIGIN', 'http://localhost:5173');
  app.enableCors({
    origin: corsOrigin.split(',').map(o => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key', 'Idempotency-Key'],
  });

  app.setGlobalPrefix('api', {
    exclude: ['webhooks/(.*)', 'health/(.*)'],
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Public OpenAPI documentation contains only partner integration routes.
  // Internal CRM endpoints must never be enumerated in this public URL.
  {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CobCom — API de Cobranças')
      .setDescription('Documentação para parceiros enviarem contratos à carteira padrão de API e gerarem Pix. Cada chave é limitada ao credor autorizado — ou, quando configurada, aos credores da mesma conta.')
      .setVersion('0.1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT access token',
        },
        'bearer',
      )
      .addApiKey(
        { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Chave de integração CobCom' },
        'apiKey',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      include: [IntegrationsModule],
      deepScanRoutes: false,
    });
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
