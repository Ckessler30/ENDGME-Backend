import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { winstonLoggerConfig } from './logger/winston-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: winstonLoggerConfig,
  });
  await app.listen(process.env.PORT ?? 3000);
  app.enableCors();
}
bootstrap();
