import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);


  const config = new DocumentBuilder()
    .setTitle('AI Image Generator — Mass Assignment Lab')
    .setDescription('Educational laboratory on Mass Assignment vulnerabilities by sp1r1t')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customCss: `
      .swagger-ui .btn.execute { margin-right: 10px; }
      .swagger-ui .btn.btn-clear { margin-left: 10px; }
      .swagger-ui .auth-btn-wrapper .btn.authorize { margin-right: 10px; }
      .swagger-ui .auth-btn-wrapper .btn-done { margin-left: 10px; }
    `,
  });

 
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false, 
      transform: true,
    }),
  );

  await app.listen(process.env.PORT || 3000);
  console.log(`Lab running → http://localhost:${process.env.PORT || 3000}`);
}
bootstrap();