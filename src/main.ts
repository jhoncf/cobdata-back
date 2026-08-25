import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
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

  // OpenAPI/Swagger — documentação da API interna e de integrações.
  // Não expõe segredos: as chaves nunca são persistidas em texto puro.
  {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CobCom - CRM API')
      .setDescription('CobCom - CRM — REST API para gestão de cobranças')
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

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
