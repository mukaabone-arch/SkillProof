import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/** PUT /interviews/:id/prep/checklist — the full set of ticked keys (unknown keys are dropped by the service). */
export class UpdatePrepChecklistDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  done!: string[];
}
