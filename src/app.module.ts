import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbUrl = configService.get<string>('DATABASE_URL') || '';
        const isSqlite = dbUrl.startsWith('sqlite:');
        
        return {
          type: isSqlite ? 'sqlite' : 'postgres',
          url: isSqlite ? undefined : dbUrl,
          database: isSqlite ? dbUrl.replace('sqlite:', '') : undefined,
          autoLoadEntities: true,
          synchronize: true,
          logging: ['error'],
        };
      },
    }),
    UsersModule,
    AuthModule,
  ],
})
export class AppModule {}