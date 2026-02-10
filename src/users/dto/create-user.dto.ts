import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'hacker' })
  @IsString() @MinLength(3) username: string;

  @ApiProperty({ example: 'hacker@example.com' })
  @IsEmail() email: string;

  @ApiProperty({ example: 'password123' })
  @IsString() @MinLength(6) password: string;

  @ApiProperty({ example: 'John Hacker', required: false })
  @IsOptional() @IsString() fullName?: string;
}