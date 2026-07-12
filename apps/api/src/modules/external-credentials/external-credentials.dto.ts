import { IsUrl, MaxLength } from 'class-validator';

export class CreateExternalCredentialDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  credentialUrl: string;
}
