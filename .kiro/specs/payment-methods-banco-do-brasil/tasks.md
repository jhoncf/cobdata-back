# Implementation Plan: Interface de Meios de Pagamento Banco do Brasil (Frontend)

## Overview

Implementação da camada frontend React/TypeScript/Chakra UI v3 para gestão de meios de pagamento e emissão de cobranças integrada ao Banco do Brasil. O frontend é consumidor puro da API REST do backend, responsável por: configuração de gateways, emissão de boletos/Pix/BolePix, visualização de histórico com atualização manual de status, tratamento robusto de erros com acessibilidade, e controle de permissões RBAC visual.

## Tasks

- [ ] 1. Tipos TypeScript, API client e hooks do módulo de pagamentos
  - [ ] 1.1 Criar tipos TypeScript do domínio de pagamentos
    - Criar arquivo `src/modules/payments/types.ts` com interfaces: `PaymentGatewaySummary`, `PaymentMethod`, `PaymentChargeStatus`, `PaymentCharge`, `PaymentPreflightResult`, `CreatePaymentChargeInput`, `UserFriendlyError`, `GeneratePixState`, `ChargeHistoryState`, `SettlementType`
    - Incluir tipos para formulário de gateway: `PaymentGatewayFormData`, `ProviderCredentialField`
    - Garantir que `PaymentCharge` inclua campos condicionais de artefatos (`digitableLine?`, `barcode?`, `pixCopyPaste?`, `qrCode?`, `pdfUrl?`, `externalRef?`) e settlement (`paidAmount?`, `settlementDate?`)
    - _Requirements: Req 1 (AC2), Req 2 (AC2), Req 3 (AC1), Req 4 (AC1, AC6)_

  - [ ] 1.2 Implementar API client Axios para módulo de pagamentos
    - Criar arquivo `src/modules/payments/api.ts` com funções: `listGateways`, `createGateway`, `updateGateway`, `toggleGatewayStatus`, `preflightCharge`, `createCharge`, `listCharges`, `refreshChargeStatuses`, `resyncCharge`, `getExistingPix`, `emitPix`
    - Configurar interceptor para tratar HTTP 403 e mapear erros para `UserFriendlyError`
    - Nunca incluir credenciais na response; API client não armazena tokens em localStorage/sessionStorage
    - _Requirements: Req 1 (AC3, AC6), Req 2 (AC8, AC9), Req 4 (AC3, AC7), Req 5 (AC1), Req 6 (AC3, AC4)_

  - [ ] 1.3 Implementar hooks React Query para pagamentos
    - Criar arquivo `src/modules/payments/hooks.ts` com hooks: `usePaymentGateways`, `useCreateGateway`, `useUpdateGateway`, `useToggleGateway`, `usePreflightValidation`, `useCreateCharge`, `useChargeHistory`, `useRefreshCharges`, `useResyncCharge`, `useExistingPix`, `useEmitPix`
    - Hooks de mutação devem gerar `Idempotency_Key` única (uuid v4) por tentativa
    - `useChargeHistory` deve fazer fetch automático no mount e suportar refresh manual
    - `useCreateCharge` e `useEmitPix` devem re-habilitar submit em caso de erro
    - _Requirements: Req 2 (AC7, AC8), Req 4 (AC3, AC4), Req 5 (AC2)_

  - [ ] 1.4 Criar mapa de erros amigáveis e utilitário de tradução
    - Criar arquivo `src/modules/payments/error-map.ts` com mapeamento de códigos de erro backend para mensagens em português não-técnicas
    - Mensagem genérica para erros desconhecidos: "Não foi possível emitir a cobrança. Tente novamente ou entre em contato com o suporte."
    - Função `parseApiError(error): UserFriendlyError` que extrai `supportReference` quando disponível
    - Garantir que nenhum HTTP status code, stack trace ou payload JSON bruto seja retornado ao usuário
    - _Requirements: Req 5 (AC1, AC3, AC5)_

- [ ] 2. Tela administrativa "Meios de pagamento"
  - [ ] 2.1 Implementar página de listagem de Payment Gateways
    - Criar componente `PaymentGatewaysPage` com lista paginada usando Table do Chakra UI
    - Exibir colunas: nome, provedor, ambiente, modalidades habilitadas (badges), status (ativo/inativo)
    - Incluir filtros por provedor e estado
    - Menu item "Meios de pagamento" visível apenas para ADMIN (oculto no DOM para outros roles)
    - Nunca exibir credenciais, tokens ou certificados em nenhum elemento da lista
    - _Requirements: Req 1 (AC1, AC2, AC3), Req 6 (AC1, AC2)_

  - [ ] 2.2 Implementar PaymentGatewayFormDialog (criar/editar)
    - Criar componente Dialog do Chakra UI para formulário de gateway
    - Campos secretos (clientId, clientSecret, certificate) usam `type="password"` com input mascarado
    - Na edição, exibir indicador "Credencial configurada ✓" sem revelar valor existente
    - Campos de credencial renderizados dinamicamente conforme tipo de provedor selecionado
    - Ações: criar, editar, ativar, desativar gateway Banco do Brasil
    - Foco inicial no dialog ao abrir (acessibilidade)
    - _Requirements: Req 1 (AC4, AC5, AC6)_

  - [ ]* 2.3 Testes unitários da tela de Payment Gateways
    - Testar renderização da lista com dados mock
    - Testar que credenciais nunca aparecem no DOM
    - Testar visibilidade condicional por role (ADMIN vê tudo, outros não veem menu)
    - Testar abertura do dialog de formulário e campos dinâmicos por provedor
    - _Requirements: Req 1 (AC1-AC6), Req 6 (AC1, AC2)_

- [ ] 3. Diálogo "Gerar cobrança" com preflight e idempotência
  - [ ] 3.1 Implementar ChargeEmissionDialog com preflight validation
    - Criar componente dialog com seleção de gateway, modalidade (Boleto/Pix/BolePix), valor e vencimento
    - Pré-preencher valor e vencimento do contrato quando disponíveis (requer confirmação explícita)
    - Ao abrir, executar preflight validation via `usePreflightValidation`
    - Se preflight retorna pendências: destacar campos com nomes amigáveis, exibir CTA "Editar contrato" que redireciona para formulário do contrato
    - Desabilitar botão submit enquanto houver pendências no preflight
    - Desabilitar botão submit se gateway inativo ou sem modalidade suportada
    - _Requirements: Req 2 (AC1, AC2, AC3, AC4, AC5, AC6)_

  - [ ] 3.2 Implementar lógica de submissão com idempotência e loading
    - Ao clicar submit: gerar nova `Idempotency_Key` (uuid v4), incluir no request
    - Desabilitar botão e exibir spinner durante requisição
    - Em sucesso: exibir `PaymentChargeResult` e invalidar query do histórico
    - Em erro: exibir `ChargeErrorFeedback`, re-habilitar botão, gerar nova key para próxima tentativa
    - Ação "Gerar cobrança" visível apenas para ADMIN e OPERATIONAL
    - _Requirements: Req 2 (AC1, AC7, AC8), Req 5 (AC2)_

  - [ ]* 3.3 Testes unitários do ChargeEmissionDialog
    - Testar preflight com pendências: botão desabilitado, campos destacados
    - Testar pré-preenchimento de valor/vencimento
    - Testar loading state durante submissão
    - Testar que idempotency key muda entre tentativas
    - Testar visibilidade apenas para ADMIN e OPERATIONAL
    - _Requirements: Req 2 (AC1-AC8), Req 6 (AC2)_

- [ ] 4. Ação "Gerar Pix" na listagem de contratos
  - [ ] 4.1 Implementar GeneratePixAction e fluxo de verificação
    - Criar componente `GeneratePixAction` (botão na listagem de contratos)
    - Ao clicar: verificar se existe Pix ativo (status ACTIVE ou PENDING) via `useExistingPix`
    - Se existe Pix válido: renderizar `ExistingPixDisplay` com copia-e-cola e QR Code + mensagem "Já existe um Pix ativo para este contrato"
    - Se não existe: chamar API de emissão via `useEmitPix` e exibir `PixEmissionResult`
    - Usar mesma lógica de idempotência da emissão geral
    - Exibir em popover/dialog leve (diferente do dialog completo de "Gerar cobrança")
    - Visível apenas para ADMIN e OPERATIONAL
    - _Requirements: Req 2 (AC9, AC10), Req 6 (AC2)_

  - [ ] 4.2 Implementar CopyPixCode com feedback acessível
    - Criar componente `CopyPixCode` com botão de copiar código Pix copia-e-cola
    - Ao copiar: feedback visual (toast ou inline) + anúncio via ARIA live region
    - Tratar falha de cópia (clipboard API não disponível) com mensagem adequada
    - _Requirements: Req 3 (AC4)_

  - [ ]* 4.3 Testes unitários do fluxo Gerar Pix
    - Testar que Pix existente é exibido ao invés de emitir novo
    - Testar emissão de novo Pix quando não existe ativo
    - Testar feedback acessível do botão copiar
    - Testar visibilidade por role
    - _Requirements: Req 2 (AC9, AC10), Req 3 (AC4)_

- [ ] 5. Checkpoint — Validar emissão e Pix
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Componente PaymentChargeResult com artefatos condicionais
  - [ ] 6.1 Implementar PaymentChargeResult e blocos de artefatos
    - Criar componente `PaymentChargeResult` que renderiza condicionalmente apenas artefatos presentes na resposta
    - Criar sub-componentes: `DigitableLineBlock`, `BarcodeBlock`, `PixCopyPasteBlock`, `QrCodeBlock`, `PdfLinkBlock`, `ExternalRefBlock`
    - Cada bloco só é renderizado se o campo correspondente está presente (truthy) na resposta
    - NÃO renderizar placeholder, skeleton ou indicador "indisponível" para artefatos ausentes
    - NÃO pressupor quais artefatos "deveriam" ter sido retornados (BolePix parcial é válido)
    - Incluir `ChargeStatusBadge` com o status da cobrança
    - Botões de copiar em `DigitableLineBlock` e `PixCopyPasteBlock` com feedback acessível
    - _Requirements: Req 3 (AC1, AC2, AC3, AC4)_

  - [ ]* 6.2 Testes unitários do PaymentChargeResult
    - Testar renderização com todos os artefatos presentes
    - Testar renderização com resposta parcial (apenas boleto, sem Pix)
    - Testar que artefatos ausentes não geram DOM elements
    - Testar feedback de cópia acessível
    - _Requirements: Req 3 (AC1-AC4)_

- [ ] 7. PaymentChargesList — histórico, Atualizar status, Ressincronizar, Settlement
  - [ ] 7.1 Implementar PaymentChargesList com histórico ordenado
    - Criar componente de lista de cobranças do contrato
    - Exibir: modalidade, valor, vencimento, status (badge), data criação, referência externa (quando disponível)
    - Ordenar por data de criação decrescente (mais recente primeiro)
    - Fetch automático ao montar o componente
    - _Requirements: Req 4 (AC1, AC2, AC4)_

  - [ ] 7.2 Implementar botão "Atualizar status" e "Ressincronizar pagamento"
    - Botão "Atualizar status" na toolbar: chama refresh em batch, spinner durante requisição, atualiza lista ao concluir
    - Sem polling automático nem WebSocket/SSE (refresh exclusivamente manual ou page reload)
    - Ação "Ressincronizar pagamento" por cobrança individual (menu de ações do card/row)
    - "Ressincronizar" visível apenas para usuários com permissão `charge:resync`
    - Feedback: toast de sucesso/erro + atualização inline do status
    - _Requirements: Req 4 (AC3, AC5, AC7)_

  - [ ] 7.3 Implementar SettlementInfo para pagamentos confirmados
    - Criar componente `SettlementInfo` que exibe valor pago e data de liquidação
    - Badge "Quitação total" (verde) quando `paidAmount >= chargeAmount`
    - Badge "Pagamento parcial" (amarelo) quando `paidAmount < chargeAmount`
    - Exibir ambos os valores (cobrado e pago) para transparência
    - Renderizar apenas quando `paidAmount` e `settlementDate` estão presentes
    - _Requirements: Req 4 (AC6)_

  - [ ]* 7.4 Testes unitários do PaymentChargesList
    - Testar ordenação por data decrescente
    - Testar "Atualizar status" com chamada API e refresh da lista
    - Testar "Ressincronizar" com mock de resposta
    - Testar SettlementInfo com pagamento total vs parcial
    - Testar visibilidade de "Ressincronizar" apenas para usuários autorizados
    - _Requirements: Req 4 (AC1-AC7)_

- [ ] 8. ChargeErrorFeedback — erro amigável, ARIA, retry, supportReference
  - [ ] 8.1 Implementar componente ChargeErrorFeedback
    - Criar componente usando Alert do Chakra UI com `role="alert"` e `aria-live="assertive"`
    - Exibir mensagem amigável traduzida via mapa de erros (nunca HTTP status, stack trace ou JSON bruto)
    - Quando `supportReference` presente: exibir "Referência para suporte: {id}" com botão copiar
    - Quando `supportReference` ausente: não renderizar placeholder de referência
    - Após exibir erro: botão submit re-habilitado para retry
    - _Requirements: Req 5 (AC1, AC2, AC3, AC4, AC5)_

  - [ ]* 8.2 Testes unitários do ChargeErrorFeedback
    - Testar que ARIA attributes estão presentes (`role="alert"`, `aria-live="assertive"`)
    - Testar exibição de supportReference quando disponível
    - Testar ausência de supportReference quando não disponível
    - Testar que nenhum dado técnico aparece na mensagem
    - _Requirements: Req 5 (AC1-AC5)_

- [ ] 9. Permissões RBAC visual — ocultar ações, tratar 403
  - [ ] 9.1 Implementar lógica de permissões e tratamento de 403
    - Criar hook `useHasPermission(action)` que verifica role do usuário
    - VIEWER: vê histórico de cobranças nas carteiras permitidas, sem ações de emissão ou configuração
    - OPERATIONAL: vê emissão e histórico
    - ADMIN: vê tudo (configuração, emissão, histórico, ressincronizar)
    - Ações não autorizadas são OCULTAS do DOM (não desabilitadas)
    - Se backend retorna 403: exibir mensagem de acesso negado e remover ação da interface
    - Nunca armazenar credenciais, tokens ou certificados em localStorage/sessionStorage/IndexedDB
    - _Requirements: Req 6 (AC1, AC2, AC3, AC4)_

  - [ ]* 9.2 Testes unitários de permissões e 403
    - Testar que VIEWER não vê botões de emissão
    - Testar que OPERATIONAL não vê configuração de gateways
    - Testar que ações não autorizadas estão ausentes do DOM (não apenas disabled)
    - Testar tratamento de 403: mensagem + remoção de ação
    - Testar que nenhum dado sensível é persistido no browser storage
    - _Requirements: Req 6 (AC1-AC4)_

- [ ] 10. Checkpoint — Validar todos os componentes e permissões
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Property-based tests com fast-check
  - [ ]* 11.1 Write property test: Credentials never leak to UI
    - **Property 1: Credentials never leak to UI**
    - Gerar objetos PaymentGateway arbitrários com campos de credencial; verificar que renderização nunca inclui valores de credencial no output
    - **Validates: Requirements 1.3, 6.4**

  - [ ]* 11.2 Write property test: Role-based action visibility
    - **Property 2: Role-based action visibility**
    - Para combinações arbitrárias de roles e ações, verificar que ações não permitidas estão ausentes do DOM
    - **Validates: Requirements 2.1, 6.1, 6.2**

  - [ ]* 11.3 Write property test: Preflight validation disables submission
    - **Property 3: Preflight validation disables submission**
    - Para resultados de preflight arbitrários com issues, verificar que botão submit está disabled e issues são exibidas com nomes amigáveis
    - **Validates: Requirements 2.4, 2.5**

  - [ ]* 11.4 Write property test: Idempotency key uniqueness
    - **Property 4: Idempotency key uniqueness**
    - Gerar sequências arbitrárias de tentativas de submissão; verificar que cada tentativa gera uma key distinta sem colisões
    - **Validates: Requirements 2.8**

  - [ ]* 11.5 Write property test: Existing Pix takes precedence
    - **Property 5: Existing Pix takes precedence over new emission**
    - Para contratos arbitrários com Pix ativo (ACTIVE/PENDING), verificar que "Gerar Pix" exibe existente ao invés de emitir novo
    - **Validates: Requirements 2.10**

  - [ ]* 11.6 Write property test: Conditional artifact rendering
    - **Property 6: Conditional artifact rendering**
    - Gerar respostas de cobrança arbitrárias com subconjuntos aleatórios de artefatos; verificar que apenas artefatos presentes geram DOM elements
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]* 11.7 Write property test: Charge history ordering
    - **Property 7: Charge history ordering**
    - Gerar listas arbitrárias de cobranças com datas aleatórias; verificar que renderização mantém ordem decrescente por createdAt
    - **Validates: Requirements 4.2**

  - [ ]* 11.8 Write property test: Settlement display accuracy
    - **Property 8: Settlement display accuracy**
    - Gerar pares arbitrários (paidAmount, chargeAmount); verificar classificação correta: "Quitação total" quando paidAmount >= chargeAmount, "Pagamento parcial" caso contrário
    - **Validates: Requirements 4.6**

  - [ ]* 11.9 Write property test: Error messages are non-technical
    - **Property 9: Error messages are non-technical**
    - Gerar respostas de erro arbitrárias (com status codes, stack traces, JSON); verificar que output renderizado não contém nenhum dado técnico e botão submit está re-habilitado
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 11.10 Write property test: Error accessibility announcement
    - **Property 10: Error accessibility announcement**
    - Para estados de erro arbitrários, verificar que container tem `role="alert"` e `aria-live="assertive"`
    - **Validates: Requirements 5.4**

  - [ ]* 11.11 Write property test: Support reference conditional inclusion
    - **Property 11: Support reference conditional inclusion**
    - Gerar erros arbitrários com e sem `supportReference`; verificar inclusão condicional correta (presente quando campo existe, ausente quando não existe)
    - **Validates: Requirements 5.5**

- [ ] 12. Final checkpoint — Validação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser ignoradas para um MVP mais rápido
- Cada task referencia requirements específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam propriedades universais de corretude definidas no design
- Stack: React, TypeScript, Chakra UI v3 (@chakra-ui/react), React Query, Axios, Vitest, Testing Library, fast-check
- O frontend é consumidor puro da API REST; não implementa OAuth, certificados nem regras específicas do BB
- Modalidades disponíveis vêm da capacidade declarada pelo gateway (não lista fixa no componente)
- Sem WebSocket/SSE nesta entrega; refresh manual é o padrão

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "9.1"] },
    { "id": 3, "tasks": ["2.3", "3.1", "8.1"] },
    { "id": 4, "tasks": ["3.2", "4.1", "6.1"] },
    { "id": 5, "tasks": ["3.3", "4.2", "7.1"] },
    { "id": 6, "tasks": ["4.3", "6.2", "7.2", "7.3"] },
    { "id": 7, "tasks": ["7.4", "8.2", "9.2"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5"] },
    { "id": 9, "tasks": ["11.6", "11.7", "11.8", "11.9", "11.10", "11.11"] }
  ]
}
```
