import { IntegrityEventType } from '@prisma/client';
import { IsEnum, IsObject, IsOptional } from 'class-validator';

/**
 * Client-reported integrity signal (tab blur, paste, right-click, fullscreen
 * exit, ...). `metadata` is intentionally loose — future event types (e.g. a
 * webcam/proctoring tier) can attach whatever shape they need without a DTO
 * change; the server never trusts anything in here for scoring, only stores
 * it as context alongside the event.
 */
export class RecordIntegrityEventDto {
  @IsEnum(IntegrityEventType)
  type: IntegrityEventType;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
