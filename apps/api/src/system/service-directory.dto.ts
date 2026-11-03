import { ApiProperty } from '@nestjs/swagger';

export class ServiceLinksDto {
  @ApiProperty({ type: String, nullable: true, description: 'Browser page or service root URL, when one exists.' })
  home!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Interactive API documentation URL, when one exists.' })
  docs!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Primary API resource URL, when one exists.' })
  api!: string | null;
}

export class ServiceConnectionDto {
  @ApiProperty({ type: String })
  host!: string;

  @ApiProperty({ type: Number })
  port!: number;

  @ApiProperty({ type: String, nullable: true })
  database!: string | null;

  @ApiProperty({ type: String, nullable: true })
  username!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Name of the local environment variable containing the password; its value is never returned.' })
  passwordEnvironmentVariable!: string | null;
}

export class ServiceLoginDto {
  @ApiProperty({ type: String, description: 'Configured login name; it is not a password.' })
  username!: string;

  @ApiProperty({ type: String, description: 'Environment variable containing the password. The password value is never returned.' })
  passwordEnvironmentVariable!: string;

  @ApiProperty({ type: String, description: 'Where the local-only default is defined if the environment variable is unset.' })
  passwordConfiguration!: string;
}

export class LocalServiceDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  type!: string;

  @ApiProperty({ type: String })
  description!: string;

  @ApiProperty({ type: () => ServiceLinksDto })
  links!: ServiceLinksDto;

  @ApiProperty({ type: () => ServiceConnectionDto, nullable: true })
  connection!: ServiceConnectionDto | null;

  @ApiProperty({ type: () => ServiceLoginDto, nullable: true })
  login!: ServiceLoginDto | null;

  @ApiProperty({ type: String, nullable: true, description: 'For local command/stdio integrations that have no HTTP address.' })
  launchCommand!: string | null;
}

export class ServiceDirectoryResponseDto {
  @ApiProperty({ type: String, enum: ['local_development'] })
  scope!: string;

  @ApiProperty({ type: String, description: 'The links are configured addresses, not live health checks. Password values are omitted.' })
  note!: string;

  @ApiProperty({ type: () => [LocalServiceDto] })
  services!: LocalServiceDto[];
}
