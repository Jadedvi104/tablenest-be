# Azure Event Hubs for Kafka

This project uses KafkaJS directly to publish the PostgreSQL transactional outbox.
Azure Event Hubs supplies the Kafka-compatible endpoint; no Nest microservice
transport or separately managed Kafka cluster is needed.

## Provision

The existing development deployment is documented in [../README.md](../README.md#azure-event-hubs-for-kafka)
and managed by `../azure-eventhubs.json`. Use its existing scoped credentials and
firewall settings for development. The Bicep template here is an alternative for
a separate new namespace: its partition count, retention, policy name, and network
defaults differ from the deployed ARM template. Do not apply it to the existing
development namespace.

Prerequisites: Azure CLI with Bicep, an authenticated account (`az login`), and
permission to deploy Event Hubs in the selected resource group. Run these
PowerShell commands from the repository root after replacing the placeholders:

```powershell
$subscription = '<subscription-id>'
$resourceGroup = '<resource-group>'
$region = '<azure-region>'
$namespace = '<globally-unique-namespace>'
az account set --subscription $subscription
az group create --name $resourceGroup --location $region
New-Item -ItemType Directory -Force .tmp | Out-Null
az bicep build --file infra/azure/main.bicep --outfile .tmp/event-hubs.json
az deployment group what-if --resource-group $resourceGroup --template-file infra/azure/main.bicep --parameters namespaceName=$namespace
az deployment group create --resource-group $resourceGroup --name ordering-kafka --template-file infra/azure/main.bicep --parameters namespaceName=$namespace
```

The template provisions Standard tier (Kafka requires Standard or above), 12
partitions, seven-day retention, and one throughput unit. Auto-inflate is disabled
to keep capacity explicit. These resources incur Azure charges. Override
`partitionCount`, `retentionDays`, and `throughputUnits` as needed; benchmark before
claiming any production throughput target. Standard partition counts cannot be
changed after creation. The endpoint is public with TLS 1.2 minimum and SASL
authentication. Private networking requires additional VNet/private endpoint
configuration appropriate to the API's hosting environment.

## Configure the API

Copy `.env.example` to `.env` if it does not already exist. Use:

```dotenv
KAFKA_BROKERS=<namespace>.servicebus.windows.net:9093
KAFKA_CLIENT_ID=restaurant-ordering-api
KAFKA_SSL=true
KAFKA_SASL_USERNAME='$ConnectionString'
KAFKA_SASL_PASSWORD='Endpoint=sb://<namespace>.servicebus.windows.net/;SharedAccessKeyName=ordering-api-send;SharedAccessKey=<secret>;EntityPath=orders.v1'
KAFKA_ORDER_TOPIC=orders.v1
```

Use the actual connection string from **Event Hubs > orders.v1 > Shared access
policies > ordering-api-send**. Alternatively, assign it directly to the current
PowerShell process without printing it:

```powershell
$env:KAFKA_BROKERS = "$namespace.servicebus.windows.net:9093"
$env:KAFKA_SSL = 'true'
$env:KAFKA_SASL_USERNAME = '$ConnectionString'
$env:KAFKA_SASL_PASSWORD = az eventhubs eventhub authorization-rule keys list --resource-group $resourceGroup --namespace-name $namespace --eventhub-name orders.v1 --name ordering-api-send --query primaryConnectionString -o tsv
if ($LASTEXITCODE -ne 0) { throw 'Unable to retrieve Event Hubs credentials' }
$env:KAFKA_ORDER_TOPIC = 'orders.v1'
npm run start:dev
```

The username contains a literal dollar sign. Use single quotes in PowerShell to
prevent interpolation. Never use the namespace's root management policy for the
API. Deployment outputs intentionally contain no secrets. In production, inject
the connection string through the hosting platform's secret store or an Azure
Key Vault reference; do not commit it or put it in deployment parameters. This
setup uses SAS credentials; managed identity authentication is not implemented.

The default Docker Compose stack explicitly uses local Redpanda. To test Azure,
run the API on the host with the settings above and run only its local database
dependency (`docker compose up -d postgres`), or configure your deployed API's
environment. Merely editing `.env` does not override Compose's explicit broker.

## Verify delivery

1. Run `npm run check` for local verification.
2. Start the API with a migrated database and the Azure settings. Startup must
   connect successfully; authentication/network failures prevent startup.
3. Create an order through the existing API using valid seeded branch/table data.
4. Confirm its outbox row has `published_at` set and Event Hubs **Incoming Messages**
   increases. A connection alone does not prove publish authorization.
5. If verifying consumption, use a separate Listen policy and Kafka consumer group;
   the API's Send policy deliberately cannot consume. Kafka consumer groups do
   not need an ARM consumer-group resource.

Allow outbound TCP 9093 and DNS resolution to the namespace. Event hubs are created
by Bicep, since automatic topic creation is disabled. Errors leave outbox rows
unpublished for retry. Kafka producer idempotence does not make database-to-Kafka
delivery exactly once: consumers must deduplicate using the stable event `id` or
`event-id` header. Readiness currently checks the database only; monitor outbox
age/backlog and publish errors for messaging health. Large Kafka requests must
remain below Event Hubs' request-size limit; load-test payloads and batches before
production (the current publisher selects up to 100 events per batch).

References: [Azure Kafka connection settings](https://learn.microsoft.com/en-us/azure/event-hubs/apache-kafka-configurations),
[Event Hubs Kafka overview](https://learn.microsoft.com/en-us/azure/event-hubs/azure-event-hubs-apache-kafka-overview),
[namespace Bicep schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.eventhub/2024-01-01/namespaces).
