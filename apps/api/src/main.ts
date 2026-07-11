import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { UPLOAD_DIR } from './config/upload-dir';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Validate every incoming request body against its DTO (spec §7.2)
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // origin: true (reflect the request's Origin) is only a safe default for
  // local dev — in production it means literally any site can call this API
  // with credentials. We don't hard-fail on a missing CORS_ORIGIN (deploying
  // once with an open CORS policy is an accepted gap, not a crash), but this
  // makes the misconfiguration loud in the Render logs instead of silent.
  if (!process.env.CORS_ORIGIN && process.env.NODE_ENV === 'production') {
    logger.warn(
      'CORS_ORIGIN is not set in production — falling back to reflecting any ' +
        'Origin (credentials: true). Set CORS_ORIGIN to your Vercel domain(s), ' +
        'comma-separated, before relying on this in real traffic.',
    );
  }
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true, credentials: true });

  // Render's disk is ephemeral unless a persistent Disk is attached and
  // mounted at UPLOAD_DIR — created here so a fresh instance/redeploy never
  // 500s on the first resume upload just because the directory is missing.
  mkdirSync(UPLOAD_DIR, { recursive: true });
  logger.log(`Resume upload dir: ${UPLOAD_DIR}`);

  const port = process.env.PORT ?? 4000;
  await app.listen(port, '0.0.0.0');
  logger.log(`SkillProof API listening on 0.0.0.0:${port}`);
}
bootstrap();
