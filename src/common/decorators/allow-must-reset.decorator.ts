import { SetMetadata } from '@nestjs/common';

export const ALLOW_MUST_RESET_KEY = 'allowMustReset';
export const AllowMustReset = () => SetMetadata(ALLOW_MUST_RESET_KEY, true);
