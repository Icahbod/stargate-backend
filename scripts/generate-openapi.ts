import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

export function addNullableToOptionalProps(document: any) {
  if (!document || !document.components || !document.components.schemas) return document;
  const schemas = document.components.schemas;
  for (const schemaName of Object.keys(schemas)) {
    const schema = schemas[schemaName];
    if (!schema || !schema.properties) continue;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const propName of Object.keys(schema.properties)) {
      const prop = schema.properties[propName];
      if (!required.includes(propName)) {
        prop.nullable = true;
      }
    }
  }
  return document;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = new DocumentBuilder().setTitle('Stargate API').setVersion('1.0').addBearerAuth().build();
  const document = SwaggerModule.createDocument(app, config);
  addNullableToOptionalProps(document);
  writeFileSync('docs/openapi.yaml', JSON.stringify(document, null, 2));
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
