import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Ensure X-Request-Id is on the response
    const requestId = request.requestId;
    if (requestId) {
      response.setHeader('X-Request-Id', requestId);
    }

    return next.handle().pipe(
      map((data) => {
        // If the response is already a paginated response (has data + meta), pass through
        if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
          return data;
        }
        // Otherwise return as-is (controllers are responsible for their own format)
        return data;
      }),
    );
  }
}
