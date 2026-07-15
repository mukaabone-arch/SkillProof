import { IsNotEmpty, IsString } from 'class-validator';

export class PostSessionTurnDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
