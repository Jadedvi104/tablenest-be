targetScope = 'resourceGroup'

@description('Globally unique Event Hubs namespace name.')
@minLength(6)
@maxLength(50)
param namespaceName string

param location string = resourceGroup().location
param topicName string = 'orders.v1'

@minValue(1)
@maxValue(32)
param partitionCount int = 12

@minValue(1)
@maxValue(7)
param retentionDays int = 7

@description('Provisioned throughput units. Size with load testing; this is a starting configuration.')
@minValue(1)
@maxValue(20)
param throughputUnits int = 1

resource eventNamespace 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: namespaceName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
    capacity: throughputUnits
  }
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    isAutoInflateEnabled: false
  }
}

resource orders 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = {
  parent: eventNamespace
  name: topicName
  properties: {
    partitionCount: partitionCount
    messageRetentionInDays: retentionDays
  }
}

resource publisher 'Microsoft.EventHub/namespaces/eventhubs/authorizationRules@2024-01-01' = {
  parent: orders
  name: 'ordering-api-send'
  properties: {
    rights: ['Send']
  }
}

// Never expose credentials in deployment outputs.
output kafkaBrokers string = '${eventNamespace.name}.servicebus.windows.net:9093'
output kafkaOrderTopic string = orders.name
output publisherPolicyName string = publisher.name
