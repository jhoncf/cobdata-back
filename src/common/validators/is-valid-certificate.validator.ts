import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import * as crypto from 'crypto';

/**
 * Custom validator that checks if a base64-encoded PFX/P12 certificate is not expired.
 * Requires the sibling property `certificatePassword` to decrypt the PFX.
 *
 * If the certificate cannot be parsed (invalid format, wrong password), validation fails
 * with a descriptive message. If the certificate is expired (notAfter < now), validation fails.
 *
 * This validator only runs when the value is provided (non-empty string).
 */
export function IsValidCertificate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidCertificate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (!value || typeof value !== 'string') {
            // Empty values are handled by @IsOptional — skip validation
            return true;
          }

          try {
            const pfxBuffer = Buffer.from(value, 'base64');
            const password = (args.object as any).certificatePassword || '';

            // Attempt to parse the PFX using Node.js crypto
            const { cert } = parsePfxCertificate(pfxBuffer, password);
            if (!cert) {
              return false;
            }

            // Check expiration using X509Certificate (Node 15+)
            const x509 = new crypto.X509Certificate(cert);
            const notAfter = new Date(x509.validTo);
            return notAfter > new Date();
          } catch {
            // If parsing fails, validation fails
            return false;
          }
        },
        defaultMessage() {
          return 'Certificate is invalid, could not be parsed, or is expired. Provide a valid, non-expired PFX/P12 certificate in base64 format.';
        },
      },
    });
  };
}

/**
 * Extracts the first certificate PEM from a PFX buffer.
 * Uses the legacy OpenSSL PKCS12 parsing available in Node.js crypto.
 */
function parsePfxCertificate(
  pfxBuffer: Buffer,
  password: string,
): { cert: string | null } {
  try {
    // Node.js doesn't have a direct PKCS12 parse API, but we can use
    // a secure context to extract the certificate chain
    const secureContext = require('tls').createSecureContext({
      pfx: pfxBuffer,
      passphrase: password,
    });

    // Extract certificate from the context
    const context = secureContext.context;
    const cert = context.getCertificate();

    if (cert) {
      return { cert: cert.toString() };
    }
    return { cert: null };
  } catch {
    return { cert: null };
  }
}
