import { ConfigService } from '@nestjs/config';
import { KafkaConfig } from 'kafkajs';

/** Validate connection settings before starting the outbox publisher. */
export function kafkaConfig(config: ConfigService): KafkaConfig | undefined {
  const brokers = config.get<string>('KAFKA_BROKERS', '').trim();
  if (!brokers) {
    if (config.get('NODE_ENV') === 'production') {
      throw new Error('KAFKA_BROKERS is required in production');
    }
    return undefined;
  }
  const endpoints = brokers.split(',').map((broker) => broker.trim());
  if (endpoints.some((broker) => !/^[\w.-]+:\d+$/.test(broker))) {
    throw new Error(
      'KAFKA_BROKERS must contain comma-separated host:port values',
    );
  }
  const ssl = config.get<string>('KAFKA_SSL', 'true');
  if (ssl !== 'true' && ssl !== 'false') {
    throw new Error('KAFKA_SSL must be true or false');
  }
  const username = config.get<string>('KAFKA_SASL_USERNAME');
  const password = config.get<string>('KAFKA_SASL_PASSWORD');
  if (Boolean(username) !== Boolean(password)) {
    throw new Error(
      'Both KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required',
    );
  }
  if (username && ssl !== 'true') {
    throw new Error('SASL credentials require KAFKA_SSL=true');
  }
  if (endpoints.some((broker) => /\.servicebus\.windows\.net:/i.test(broker))) {
    if (
      ssl !== 'true' ||
      username !== '$ConnectionString' ||
      !password ||
      !endpoints.every((broker) => broker.endsWith(':9093'))
    ) {
      throw new Error(
        'Azure Event Hubs requires TLS, port 9093, and SASL username $ConnectionString with a connection string password',
      );
    }
  }
  const topic = config.get<string>('KAFKA_ORDER_TOPIC', 'orders.v1');
  if (!topic.trim()) throw new Error('KAFKA_ORDER_TOPIC must not be empty');
  return {
    clientId: config.get<string>('KAFKA_CLIENT_ID', 'restaurant-ordering-api'),
    brokers: endpoints,
    ssl: ssl === 'true',
    sasl:
      username && password
        ? { mechanism: 'plain', username, password }
        : undefined,
    // Event Hubs requires a longer request timeout for idempotent producers.
    requestTimeout: 60_000,
    retry: { retries: 5 },
  };
}
