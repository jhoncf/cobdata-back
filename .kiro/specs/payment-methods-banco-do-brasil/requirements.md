# Requirements Document

## Introduction

Permitir que o CobCom - CRM emita cobranças vinculadas a contratos, por meio de uma arquitetura extensível para múltiplos provedores e modalidades de pagamento. A primeira implementação será Banco do Brasil, com boleto, Pix e BolePix.

**Fora de escopo desta entrega:**
- Cobrança recorrente, split, conciliação contábil e estorno.
- Emissão real em produção durante desenvolvimento ou testes automatizados.
- Suporte a outros bancos; a abstração deve deixá-los prontos para inclusão posterior.

## Glossary

- **Payment_Gateway**: Configuração de um provedor capaz de emitir e acompanhar cobranças, vinculada a uma Account e ambiente (homologação ou produção).
- **Payment_Provider**: Integração externa que implementa as modalidades suportadas (inicialmente Banco do Brasil).
- **Payment_Charge**: Instrução de pagamento emitida para um contrato, contendo referência externa, status e artefatos do provedor.
- **Payment_Settlement**: Registro financeiro imutável de um recebimento confirmado, vinculado ao contrato e opcionalmente à cobrança e ao acordo.
- **BolePix**: Cobrança bancária que disponibiliza código de barras/linha digitável e Pix, quando suportado pelo provedor.
- **Pre_Validation**: Verificação dos dados necessários antes de qualquer chamada ao provedor externo.
- **txid**: Identificador técnico único de uma cobrança Pix no Banco do Brasil, gerado pelo sistema e nunca informado pelo usuário.
- **Idempotency_Key**: Chave única de emissão que garante que repetições da mesma solicitação não criam cobranças duplicadas.
- **Payment_Provider_Adapter**: Interface/porta que encapsula o protocolo de comunicação com um provedor de pagamento específico.
- **Payment_Provider_Factory**: Componente responsável por selecionar o adaptador correto com base no tipo do provedor configurado.
- **mTLS_Certificate_A1**: Certificado digital padrão A1 exigido pela API Pix v2 do Banco do Brasil para conexão mTLS.
- **Pix_Receiver_Key**: Chave Pix recebedora configurada no Payment_Gateway, que identifica a conta que receberá o pagamento.
- **Contract**: Entidade de negócio que contém dados do devedor, valor e vencimento, à qual cobranças são vinculadas.
- **Account**: Entidade organizacional (tenant) do sistema; cada Account pode ter suas próprias configurações de Payment_Gateway.
- **Wallet**: Carteira de contratos usada para controle de acesso (RBAC); não determina o meio de pagamento.
- **Channel**: Origem da solicitação de emissão (COBCOM para CRM interno, ou canais externos como landing page, WhatsApp, chatbot).
- **Payment_Settlement_Event**: Contrato canônico interno que unifica eventos de pagamento de diferentes provedores (Serasa, Banco do Brasil, etc.).
- **Charge_Lifecycle_Job**: Processo agendado que reconcilia estados de cobranças com o provedor externo, tratando timeouts pendentes e cobranças vencidas.

## Requirements

### Requirement 1: Cadastro de Meios de Pagamento

**User Story:** As an admin, I want to register, edit, activate and deactivate payment gateways per Account, so that the organization can manage which payment providers are available for issuing charges.

#### Acceptance Criteria

1. THE Payment_Gateway SHALL allow ADMIN users to create, update, activate and deactivate payment gateway configurations per Account.
2. WHEN a Payment_Gateway is created, THE System SHALL require name, provider type, environment (homologação or produção), activation state and enabled payment methods (BOLETO, PIX, BOLEPIX).
3. THE Payment_Provider_Factory SHALL support `BANCO_DO_BRASIL` as the first provider type without limiting future provider additions.
4. WHILE only one Payment_Gateway of the same provider type exists per Account and environment, THE System SHALL resolve it as the default gateway for charge issuance; charges remain linked directly to the Contract, never to the Wallet.
5. WHEN a Payment_Gateway is queried via API, THE System SHALL never return credentials in responses, logs, audit records or error messages.

### Requirement 2: Segurança das Credenciais

**User Story:** As an admin, I want credentials to be stored encrypted and never exposed, so that sensitive data from the payment provider is protected at rest and in transit.

#### Acceptance Criteria

1. WHEN credentials are stored, THE System SHALL encrypt them at rest using the existing cryptography service already used by external channels.
2. THE System SHALL prevent secrets received from local configuration from being versioned, copied to documentation, or exposed to the front-end.
3. THE Payment_Provider_Adapter SHALL use only the official Banco do Brasil documentation as the authoritative source for authentication, certificates, scopes and request formats.
4. WHEN a Payment_Gateway for Banco do Brasil is configured, THE System SHALL require a Pix_Receiver_Key that identifies the receiving account; the Pix_Receiver_Key SHALL be protected in configuration and never obtained from the debtor.
5. WHEN the API Pix v2 connection is established, THE System SHALL use an mTLS_Certificate_A1 for mutual TLS authentication, storing the certificate, private key and its password in encrypted form, controlling expiration, and never exposing these materials in any output.

### Requirement 3: Dados de Cobrança no Contrato

**User Story:** As an operational user, I want the contract to contain all required data for charge issuance, so that charges can be emitted without manual data entry at issuance time.

#### Acceptance Criteria

1. THE Contract SHALL contain a positive monetary value and a due date usable for charge issuance.
2. WHEN a payment method requires debtor data, THE System SHALL support: name, CPF/CNPJ, optional e-mail, optional phone, address street, address number, optional complement, neighborhood, city, state (UF) and zip code (CEP).
3. WHEN a charge issuance is requested, THE Pre_Validation SHALL validate CPF/CNPJ format, CEP format, UF validity, positive amount and valid due date before any call to the payment provider.
4. IF the Contract data is insufficient for the requested payment method, THEN THE System SHALL return a validation error listing exactly which fields are missing, without creating a charge or calling the external provider.

### Requirement 4: Emissão de Cobrança

**User Story:** As an admin or operational user, I want to issue a payment charge for an active contract in BOLETO, PIX or BOLEPIX mode, so that the debtor can pay through the chosen method.

#### Acceptance Criteria

1. WHEN an ADMIN or OPERATIONAL user requests a charge, THE System SHALL accept contract reference, amount, due date, payment method (BOLETO, PIX or BOLEPIX) and Payment_Gateway reference.
2. WHEN amount and due date are not explicitly provided, THE System SHALL default to the Contract values but require explicit confirmation before issuance.
3. WHEN a charge is issued, THE Payment_Provider_Factory SHALL select the correct Payment_Provider_Adapter via factory/resolver pattern, never through conditionals scattered in controllers.
4. WHEN the provider successfully issues a charge, THE Payment_Charge SHALL persist: external identifier, status, amount, due date, instruction text, and all artifacts provided by the provider (digitable line, barcode, URL/PDF when available, txid, Pix copia-e-cola and QR Code when available).
5. IF the payment provider returns an error, THEN THE System SHALL persist the charge with status `FAILED` including failure code and message, without duplicating an already issued charge.
6. WHEN the same Idempotency_Key is submitted for the same Payment_Gateway, THE System SHALL return the existing charge instead of creating a duplicate; the user cannot generate duplicity by reloading the screen or repeating the request.
7. WHEN a new Pix charge is issued, THE System SHALL generate a unique txid for the charge; the txid is a technical identifier managed by the system and SHALL NOT be provided by the user.
8. THE Payment_Provider_Adapter SHALL use a configurable timeout per Payment_Gateway for all outbound HTTP calls; IF the call exceeds the timeout without a response, THEN THE System SHALL persist the Payment_Charge with status `PENDING` (since no confirmation of failure was received) and allow the Charge_Lifecycle_Job to reconcile on the next execution.
9. WHEN the provider API returns HTTP 429 or a throttling response, THE Payment_Provider_Adapter SHALL retry the request using exponential backoff with jitter up to a configurable maximum number of retries; IF all retries are exhausted, THEN THE System SHALL persist the Payment_Charge with status `FAILED` and failure code `RATE_LIMITED`.

### Requirement 5: Emissão de Pix por CPF para Canais Externos

**User Story:** As an external channel (landing page, WhatsApp, chatbot), I want to generate a Pix charge by providing a debtor CPF/CNPJ and contract number, so that debtors can pay directly without CRM intervention.

#### Acceptance Criteria

1. WHEN a CPF/CNPJ (normalized or formatted) and contract number are submitted, THE System SHALL locate the single eligible Contract for payment matching that combination via an authenticated endpoint.
2. THE System SHALL emit only Pix charges via this endpoint in this delivery and return the Pix copia-e-cola along with the charge reference; boleto and BolePix remain conditioned to future provider capabilities.
3. WHEN a Pix is issued via external channel, THE Payment_Charge SHALL be linked to the found Contract; the Wallet serves only for access control rules and does not determine the payment method.
4. IF no eligible Contract exists for the provided document and contract number, THEN THE System SHALL return HTTP 404 without calling the Banco do Brasil API.
5. IF the CPF/CNPJ and contract number do not identify exactly one eligible Contract (zero or multiple matches), THEN THE System SHALL return HTTP 404 or HTTP 409 without issuing a Pix charge.
6. WHEN a Contract is inactive, cancelled, settled, has no positive value, or has no valid due date/expiration rule, THE System SHALL reject the Pix issuance request.
7. WHEN the same Idempotency_Key is repeated for the same Contract, THE System SHALL return the previously issued Pix charge without creating a new one.
8. THE System SHALL also provide a manual Pix issuance endpoint by contract identifier for CRM use: `POST /contracts/:contractId/payment-charges/pix`.
9. WHEN a Pix charge is issued, THE System SHALL always use the `updatedValue` field from the Contract; IF `updatedValue` is not populated, THEN THE System SHALL reject the issuance.
10. WHEN a Pix issuance is requested for a Contract, THE System SHALL first check for an existing open and still-valid Pix charge for that Contract and reuse it; a new charge SHALL only be created if no valid Pix exists.
11. THE System SHALL set the default Pix expiration to 24 hours, configurable per environment; WHEN a Pix charge expires, THE System SHALL not reuse it for subsequent requests.
12. WHEN a Pix charge is issued via external channel, THE System SHALL return only: `chargeId`, `contractId`, `txid`, `amount`, `expiresAt`, `pixCopyPaste` and `status`.
13. WHEN a Pix charge is issued manually via CRM, THE System SHALL attribute the channel as `COBCOM`.
14. THE System SHALL use immediate Pix charge (`Cob`) with 24-hour expiration and accept only full payment of the `updatedValue` in this first delivery.

### Requirement 6: Consulta e Ciclo de Vida

**User Story:** As an operational user, I want to query charges for a contract and track their lifecycle, so that I can monitor payment status and take action when needed.

#### Acceptance Criteria

1. WHEN charges are queried for a Contract, THE System SHALL list them in descending order of creation date.
2. THE Payment_Charge SHALL support at minimum the states: `PENDING`, `ISSUED`, `PAID`, `CANCELLED`, `EXPIRED` and `FAILED`.
3. THE System SHALL support status updates both by polling the provider and by webhook reception, even if the first delivery implements only the events officially available for Banco do Brasil.
4. WHEN cancellation/write-off is requested, THE System SHALL only allow it for payment methods and charge states that the provider supports for cancellation.
5. THE System SHALL run a periodic Charge_Lifecycle_Job (configurable schedule) to identify Payment_Charges past their due date that remain in `PENDING` or `ISSUED` status; the job SHALL query the provider for the current status before transitioning the charge to `EXPIRED`.
6. IF the provider confirms a charge past due date was paid, THEN THE Charge_Lifecycle_Job SHALL transition it to `PAID` regardless of the local due date; IF the provider is unreachable, THE job SHALL log the failure and retry on the next execution without changing the charge status.

### Requirement 7: Webhook e Ressincronização

**User Story:** As a system operator, I want webhook reception and manual resync capabilities, so that payment confirmations are processed even when automatic notifications fail.

#### Acceptance Criteria

1. THE System SHALL provide a dedicated webhook endpoint for Banco do Brasil (`POST /webhooks/banco-do-brasil/pix`), publicly accessible and protected according to the authentication defined by the BB API.
2. WHEN a webhook notification is received, THE System SHALL deduplicate the event and process payment confirmations idempotently, never creating duplicate settlements.
3. THE System SHALL provide a manual resync endpoint (`POST /payment-charges/:id/sync`) for ADMIN/OPERATIONAL users to query charge status from the provider when the webhook is not received.
4. WHILE the backend is not published at a public HTTPS production URL, THE System SHALL validate payment confirmation via resync and automated tests/mocks; the dedicated BB webhook SHALL be registered only when the backend is published in production.
5. WHEN a webhook notification is received, THE System SHALL verify its authenticity according to the official Banco do Brasil specification (mTLS, IP whitelist, or signature validation as required by the API version) before processing the payload.
6. IF the webhook authenticity verification fails, THEN THE System SHALL reject the request with HTTP 401 and log the rejection event (source IP and timestamp) without exposing internal details.

### Requirement 8: Registro Financeiro de Pagamentos

**User Story:** As a finance operator, I want every confirmed payment to be recorded as an immutable settlement with full traceability, so that the financial history is auditable and consistent across all payment channels.

#### Acceptance Criteria

1. WHEN a payment is confirmed by the provider, THE System SHALL record it as an immutable Payment_Settlement linked to the Contract and, when applicable, to the Payment_Charge and the agreement that originated it.
2. THE Payment_Settlement SHALL record at minimum: paid amount in BRL, effective payment date/time, source (`PIX`, `SERASA` or future channel), external identifier, status and charge reference.
3. WHEN partial payments or multiple installments occur, THE System SHALL create distinct Payment_Settlement records; `paidInstallments` SHALL NOT be the sole source of financial information.
4. THE Contract SHALL expose a derived summary containing `totalPaidAmount`, `lastPaymentAt` and outstanding balance, without replacing the Payment_Settlement history.
5. WHEN a Payment_Charge is paid, THE System SHALL NOT automatically settle the Contract, except when the financial rule confirms that total settled amount has reached the applicable agreement value.
6. WHEN a reversal, subsequent refusal or agreement breach occurs, THE System SHALL record it as a traceable financial event without deleting the original Payment_Settlement.
7. THE Payment_Settlement_Event contract SHALL be canonical and compatible with existing Serasa agreement events (`PaidAgreementEvent` and `PaidInstallmentEvent`), so that Banco do Brasil and future channels act merely as source adapters.
8. WHEN a payment return is processed, THE System SHALL preserve: channel event/transaction identifier, debt/contract reference, agreement reference when applicable, installment number when applicable, amount, effective payment date, status, and provider-specific payload protected for traceability.

### Requirement 9: Permissões e Auditoria

**User Story:** As a system administrator, I want role-based access control and comprehensive audit logging for all payment operations, so that actions are traceable and data access follows the principle of least privilege.

#### Acceptance Criteria

1. WHILE a user has VIEWER role, THE System SHALL allow charge queries only for Contracts in the Wallets the user has access to, without exposing secret data.
2. WHILE a user has ADMIN or OPERATIONAL role, THE System SHALL allow charge issuance for Contracts in the Wallets the user has access to.
3. WHEN any of the following events occurs — creation, failure, external query, payment, cancellation or configuration change — THE System SHALL generate an audit record containing the responsible user, affected resource and outcome, without PII or secrets in metadata.
