import { ConfigService } from '@nestjs/config';
import { kafkaConfig } from './kafka.config';

describe('kafkaConfig', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  const azure = {
    KAFKA_BROKERS: 'restaurant.servicebus.windows.net:9093',
    KAFKA_SASL_USERNAME: '$ConnectionString',
    KAFKA_SASL_PASSWORD: 'test-secret',
  };
  const resolve = (values: Record<string, string | undefined> = {}) => {
    const config = new ConfigService(values);
    return kafkaConfig(config);
  };

  it('allows an unconfigured development publisher but rejects it in production', () => {
    expect(resolve()).toBeUndefined();
    expect(() => resolve({ NODE_ENV: 'production' })).toThrow(
      'required in production',
    );
  });

  it('supports local Kafka without SASL', () => {
    expect(
      resolve({ KAFKA_BROKERS: 'one:9092, two:9092', KAFKA_SSL: 'false' }),
    ).toMatchObject({
      brokers: ['one:9092', 'two:9092'],
      ssl: false,
      sasl: undefined,
    });
  });

  it('uses TLS and SASL PLAIN for Azure', () => {
    expect(resolve(azure)).toMatchObject({
      ssl: true,
      requestTimeout: 60_000,
      sasl: {
        mechanism: 'plain',
        username: '$ConnectionString',
        password: 'test-secret',
      },
    });
  });

  it.each([
    { KAFKA_BROKERS: 'broker:9092,' },
    { KAFKA_SSL: 'yes' },
    { KAFKA_SASL_USERNAME: '' },
    { KAFKA_SASL_PASSWORD: '' },
    { KAFKA_SSL: 'false' },
    { KAFKA_SASL_USERNAME: 'wrong' },
    { KAFKA_BROKERS: 'restaurant.servicebus.windows.net:9092' },
    { KAFKA_ORDER_TOPIC: ' ' },
  ])(
    'rejects invalid configuration without revealing secrets: %j',
    (override) => {
      expect(() => resolve({ ...azure, ...override })).toThrow();
      try {
        resolve({ ...azure, ...override });
      } catch (error) {
        expect((error as Error).message).not.toContain('test-secret');
      }
    },
  );

  it('rejects Azure without authentication even when TLS is enabled', () => {
    expect(() => resolve({ KAFKA_BROKERS: azure.KAFKA_BROKERS })).toThrow(
      'Azure Event Hubs requires',
    );
  });
});
