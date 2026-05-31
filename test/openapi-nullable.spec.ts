import { addNullableToOptionalProps } from '../scripts/generate-openapi';

describe('OpenAPI nullable postprocessing', () => {
  it('adds nullable: true to optional schema properties', () => {
    const doc: any = {
      components: {
        schemas: {
          TestType: {
            properties: {
              requiredProp: { type: 'string' },
              optionalProp: { type: 'string' },
            },
            required: ['requiredProp'],
          },
        },
      },
    };

    const out = addNullableToOptionalProps(doc);
    expect(out.components.schemas.TestType.properties.optionalProp.nullable).toBe(true);
    expect(out.components.schemas.TestType.properties.requiredProp.nullable).toBeUndefined();
  });
});
