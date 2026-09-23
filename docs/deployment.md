# Deploy e armazenamento

## Produção

A produção usa o bucket AWS S3 `cobcomcrm` na região `us-east-1`. A instância
deve ter uma IAM Role com acesso de leitura, gravação e exclusão ao bucket.
Não configure chaves estáticas AWS no arquivo de ambiente de produção.

O deploy é executado pelo workflow `.github/workflows/deploy-production.yml`.
Ele gera `.env.production` com `STORAGE_PROVIDER=aws`, executa as migrations e
recria somente os serviços de Redis, migrations e API. O MinIO não faz parte
da composição de produção.

Após um deploy, valide:

```sh
curl -fsS http://localhost:18080/health/live
docker compose -f docker-compose.production.yml ps
```

## Desenvolvimento local

O arquivo `docker-compose.yml` mantém o MinIO para desenvolvimento local. Use
`STORAGE_PROVIDER=minio` e as variáveis `S3_ENDPOINT`, `S3_PORT`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY` e `S3_BUCKET` presentes em `.env.example`.
O MinIO local é compatível com S3 e não deve ser confundido com o bucket AWS de
produção.

## Migração concluída

Os objetos existentes foram copiados do MinIO de produção para o S3 antes do
apontamento. O volume legado do MinIO não é removido automaticamente: ele fica
preservado como contingência até uma decisão explícita de descarte.
