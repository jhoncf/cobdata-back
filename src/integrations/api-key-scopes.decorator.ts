import { SetMetadata } from '@nestjs/common';
import { ApiKeyScope } from '@prisma/client';

export const API_KEY_SCOPES_KEY = 'apiKeyScopes';
export const ApiKeyScopes = (...scopes: ApiKeyScope[]) => SetMetadata(API_KEY_SCOPES_KEY, scopes);
