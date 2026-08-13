# Requirements Document

## Introduction

O CobData Back-end MVP é uma API REST segura e auditável que serve como camada única de acesso ao PostgreSQL. A API autentica o front-end com JWT, gerencia credores, carteiras, contratos e importações, e integra contratos ao Serasa Limpa Nome Parceiros (LNOP) por meio de uma abstração de provedores de cobrança. O sistema utiliza NestJS com TypeScript estrito, Prisma ORM, Redis + BullMQ para processamento assíncrono e armazenamento compatível com S3. O sistema é single-tenant no MVP, mas o modelo de dados mantém a entidade Account para facilitar eventual migração para multi-tenant. Ambos os ambientes (local e produção) rodam em containers Docker com docker-compose para orquestração dos serviços (API, PostgreSQL, Redis, MinIO).

## Glossary

- **API**: A aplicação NestJS que expõe endpoints REST em `/api`
- **Account**: Entidade organizacional do sistema; no MVP existe apenas uma Account (single-tenant), mantida no modelo para future-proofing
- **User**: Usuário autenticado vinculado à Account com um papel definido
- **Role**: Papel do usuário — `ADMIN`, `OPERATIONAL` ou `VIEWER`
- **Scope**: Conjunto de carteiras a que um VIEWER tem acesso explícito
- **Creditor**: Credor — pessoa jurídica ou física dona de créditos
- **Wallet**: Carteira — agrupamento lógico de contratos pertencente a um credor
- **Contract**: Contrato — entidade canônica da dívida com dados do devedor e valores
- **ImportBatch**: Lote de importação — conjunto de registros enviados via CSV/XLSX
- **Provider**: Provedor de cobrança externo configurado no sistema (ex: Serasa LNOP)
- **ProviderOperation**: Operação de provedor — envio de contratos em lotes a um provedor
- **ProviderOperationItem**: Item individual de uma operação com status de processamento
- **Webhook**: Notificação HTTP recebida de um provedor externo
- **AccessToken**: Token JWT de curta duração usado para autenticar requisições
- **RefreshToken**: Token rotativo entregue em cookie HttpOnly para renovar sessão
- **BullMQ_Worker**: Processador assíncrono de jobs via BullMQ e Redis
- **DeduplicationKey**: Chave composta usada para evitar duplicação de contratos
- **Invite**: Convite enviado por ADMIN para cadastro de novo usuário
- **DebtType**: Tipo de dívida — enumeração dos tipos aceitos: `COMMERCIAL` (comercial), `BANKING` (bancário), `SERVICES` (serviços), `UTILITIES` (utilidades), `TELECOM` (telecomunicações), `EDUCATION` (educação), `HEALTH` (saúde), `CONDOMINIAL` (condominial), `OTHER` (outro)

## Requirements

### Requisito 1: Login e emissão de tokens

**User Story:** Como um usuário do CobData, eu quero fazer login com e-mail e senha, para que eu receba tokens que me autentiquem nas requisições subsequentes.

#### Critérios de Aceite

1. WHEN um usuário envia e-mail e senha válidos para `POST /auth/login`, THE API SHALL retornar um AccessToken JWT com tempo de expiração de 15 minutos no corpo da resposta e um RefreshToken com tempo de expiração de 7 dias em cookie `HttpOnly`, `Secure`, com `SameSite=Strict` em produção e `SameSite=Lax` em desenvolvimento.
2. WHEN um usuário envia credenciais inválidas para `POST /auth/login`, THE API SHALL retornar HTTP 401 com mensagem genérica sem indicar se o e-mail ou a senha está incorreto.
3. WHEN um usuário com status inativo (campo `isActive` igual a `false`) tenta fazer login, THE API SHALL retornar HTTP 401 com a mesma mensagem genérica de credenciais inválidas.
4. THE API SHALL armazenar senhas utilizando o algoritmo Argon2id.
5. WHEN ocorrem 5 ou mais falhas consecutivas de login para o mesmo e-mail dentro de uma janela de 15 minutos, THE API SHALL bloquear novas tentativas de login para esse e-mail por 15 minutos e registrar o evento em auditoria sem incluir a senha tentada.
6. IF uma tentativa de login é feita para um e-mail que está temporariamente bloqueado por rate limit, THEN THE API SHALL retornar HTTP 429 com mensagem indicando que o limite de tentativas foi excedido e informando o tempo restante de bloqueio em segundos.

### Requisito 2: Renovação e encerramento de sessão

**User Story:** Como um usuário autenticado, eu quero renovar meu token de acesso sem precisar informar minhas credenciais novamente, para que minha sessão permaneça ativa de forma segura.

#### Critérios de Aceite

1. WHEN um usuário envia `POST /auth/refresh` com um RefreshToken válido (não expirado, não revogado e pertencente a uma família de tokens ativa) no cookie, THE API SHALL retornar um novo AccessToken com tempo de expiração de 15 minutos e rotacionar o RefreshToken no cookie com tempo de expiração de 7 dias, invalidando o RefreshToken anterior.
2. IF um RefreshToken já utilizado (reuso detectado) ou expirado é enviado em `POST /auth/refresh`, THEN THE API SHALL retornar HTTP 401 e invalidar todos os RefreshTokens pertencentes à mesma família de tokens.
3. WHEN um usuário envia `POST /auth/logout` com um RefreshToken válido no cookie, THE API SHALL invalidar o RefreshToken atual, remover os cookies de RefreshToken e AccessToken da resposta, e retornar HTTP 204.
4. IF a requisição `POST /auth/refresh` não contiver o cookie de RefreshToken ou o valor do cookie estiver malformado, THEN THE API SHALL retornar HTTP 401 sem invalidar nenhuma sessão existente.

### Requisito 3: Consulta de identidade e permissões

**User Story:** Como um usuário autenticado, eu quero consultar meus dados de sessão, para que o front-end saiba meu papel e escopos efetivos.

#### Critérios de Aceite

1. WHEN um usuário autenticado envia `GET /auth/me`, THE API SHALL retornar em até 500ms um objeto contendo: o ID e e-mail do usuário, o nome do Role atribuído, e a lista de Scopes efetivos (para o role VIEWER, os IDs das wallets concedidas; para outros roles, uma lista vazia).
2. THE API SHALL incluir no JWT exclusivamente os campos `sub` (ID do usuário), `accountId`, `role`, `sessionId`, `iat` e `exp`, excluindo nome, e-mail, telefone, documento e quaisquer campos de permissão ou escopo.
3. IF a requisição `GET /auth/me` não contiver um token JWT válido e não expirado, THEN THE API SHALL rejeitar a requisição com status HTTP 401 e um corpo contendo uma mensagem de erro indicando autenticação ausente ou inválida, sem revelar detalhes internos do sistema.

### Requisito 4: Convite e cadastro de usuários

**User Story:** Como um administrador, eu quero convidar novos usuários por e-mail, para que eles possam acessar o sistema com papel e escopos pré-definidos após confirmarem sua identidade.

#### Critérios de Aceite

1. WHEN um ADMIN envia `POST /users/invite` com e-mail, Role e Scopes opcionais, THE API SHALL criar um registro de convite com status `PENDING`, gerar um token de convite com expiração de 72 horas e enviar um e-mail ao destinatário contendo um link de ativação.
2. WHEN o usuário convidado acessa o link de ativação com token válido via `POST /auth/activate`, THE API SHALL permitir a definição de senha (mínimo 8 caracteres, ao menos uma letra maiúscula, uma minúscula e um dígito) e, ao confirmar, ativar o usuário com `isActive = true` e e-mail confirmado.
3. IF o token de convite estiver expirado ou já utilizado, THEN THE API SHALL retornar HTTP 410 (Gone) com mensagem indicando que o convite não é mais válido.
4. IF o e-mail informado no convite já pertence a um usuário ativo no sistema, THEN THE API SHALL rejeitar o convite com HTTP 409 indicando que o e-mail já está em uso.
5. WHEN um ADMIN consulta `GET /users`, THE API SHALL retornar a lista paginada de usuários incluindo status (PENDING, ACTIVE, INACTIVE).
6. WHEN um ADMIN envia `PATCH /users/:id`, THE API SHALL permitir alterar Role, Scopes e status (ativar/desativar) do usuário.
7. THE API SHALL validar o formato do e-mail no momento do convite e rejeitar endereços sintaticamente inválidos com HTTP 422.
8. WHEN um ADMIN envia `POST /users/:id/resend-invite` para um usuário com status PENDING, THE API SHALL gerar novo token de convite com expiração de 72 horas, invalidar o anterior e reenviar o e-mail de ativação.
9. THE API SHALL manter no modelo de dados campos preparatórios para 2FA (ex: `twoFactorSecret`, `twoFactorEnabled`), sem ativar o fluxo de autenticação de dois fatores no MVP.
10. IF a operação `PATCH /users/:id` resultaria na desativação ou rebaixamento de role do último usuário ADMIN ativo no sistema, THEN THE API SHALL rejeitar a requisição com HTTP 409 indicando que o sistema deve manter ao menos um ADMIN ativo.

### Requisito 5: Troca e recuperação de senha

**User Story:** Como um usuário, eu quero alterar minha senha ou recuperá-la caso esqueça, para que eu mantenha acesso seguro à minha conta.

#### Critérios de Aceite

1. WHEN um usuário autenticado envia `POST /auth/change-password` com senha atual e nova senha, THE API SHALL validar a senha atual, aplicar as regras de complexidade à nova senha (mínimo 8 caracteres, maiúscula, minúscula e dígito), atualizar o hash Argon2id e invalidar todas as sessões ativas do usuário exceto a corrente.
2. IF a senha atual informada em `POST /auth/change-password` estiver incorreta, THEN THE API SHALL retornar HTTP 401 com mensagem genérica.
3. WHEN um usuário não autenticado envia `POST /auth/forgot-password` com e-mail, THE API SHALL gerar um token de reset com expiração de 1 hora e enviar e-mail com link de redefinição, retornando HTTP 202 independentemente de o e-mail existir ou não (para não vazar informação).
4. WHEN um usuário envia `POST /auth/reset-password` com token de reset válido e nova senha, THE API SHALL atualizar o hash da senha, invalidar o token e encerrar todas as sessões ativas do usuário.
5. IF o token de reset estiver expirado ou já utilizado, THEN THE API SHALL retornar HTTP 410 (Gone) com mensagem indicando que o link não é mais válido.
6. WHEN um ADMIN envia `POST /users/:id/force-reset`, THE API SHALL invalidar a senha do usuário, encerrar todas as sessões ativas e marcar o usuário como `mustResetPassword = true`, forçando redefinição no próximo login.
7. WHEN um usuário com `mustResetPassword = true` faz login com sucesso, THE API SHALL retornar um token de acesso restrito que permite apenas a operação de troca de senha, bloqueando acesso a outros endpoints até a redefinição ser concluída.

### Requisito 6: Gestão de sessões

**User Story:** Como um usuário, eu quero poder usar o sistema em múltiplos dispositivos simultaneamente, e como administrador, eu quero visibilidade sobre sessões ativas para segurança.

#### Critérios de Aceite

1. THE API SHALL permitir múltiplas sessões simultâneas por usuário, sem limite máximo de dispositivos.
2. WHEN um usuário autenticado envia `GET /auth/sessions`, THE API SHALL retornar a lista de sessões ativas do usuário com: sessionId, dispositivo/user-agent resumido, IP de origem, data de criação e indicação de qual é a sessão corrente.
3. WHEN um usuário autenticado envia `DELETE /auth/sessions/:sessionId`, THE API SHALL invalidar a sessão especificada e retornar HTTP 204. IF o `sessionId` corresponde à sessão corrente do usuário, THEN THE API SHALL rejeitar a requisição com HTTP 409 indicando que a sessão corrente não pode ser encerrada por este endpoint (use `POST /auth/logout` em vez disso).
4. WHEN um usuário autenticado envia `DELETE /auth/sessions` (sem ID), THE API SHALL invalidar todas as sessões do usuário exceto a corrente e retornar HTTP 204.
5. WHEN a senha do usuário é alterada (via change-password, reset-password ou force-reset), THE API SHALL invalidar todas as sessões ativas exceto a sessão que executou a troca (quando aplicável).

### Requisito 7: Modelo organizacional e future-proofing

**User Story:** Como desenvolvedor, eu quero que o modelo de dados mantenha a entidade Account mesmo em single-tenant, para que uma eventual migração para multi-tenant não exija refatoração estrutural.

#### Critérios de Aceite

1. THE API SHALL manter a entidade Account no modelo de dados; no MVP, uma única Account é criada via seed e todos os usuários e recursos pertencem a ela.
2. THE API SHALL incluir `accountId` no JWT para consistência do modelo, vinculando-o à Account única do sistema.
3. THE API SHALL associar todo recurso de negócio (Creditor, Wallet, Contract, ImportBatch, Provider, ProviderOperation) à Account única via foreign key no banco de dados.
4. THE API SHALL não expor endpoints de criação ou gestão de Accounts no MVP.

### Requisito 8: Autorização baseada em papéis e escopos

**User Story:** Como administrador, eu quero restringir o acesso de visualizadores a carteiras específicas, para que cada operador veja apenas os dados que lhe competem.

#### Critérios de Aceite

1. WHILE um usuário possui Role `ADMIN`, THE API SHALL conceder acesso de leitura, escrita e exclusão a todos os recursos, incluindo gerenciamento de usuários e atribuição de Scopes.
2. WHILE um usuário possui Role `OPERATIONAL`, THE API SHALL conceder acesso de leitura e escrita a todos os recursos, exceto gerenciamento de usuários, atribuição de Scopes, configuração de provedores e exclusão de recursos (soft delete de credores e carteiras).
3. WHILE um usuário possui Role `VIEWER`, THE API SHALL conceder acesso somente-leitura restrito às Wallets presentes nos Scopes explícitos do usuário, negando qualquer operação de escrita, exclusão ou acesso a Wallets fora desses Scopes.
4. WHEN um VIEWER tenta acessar uma Wallet fora de seus Scopes, THE API SHALL retornar HTTP 403 indicando permissão insuficiente.
5. WHEN um VIEWER consulta listagens, resumos ou métricas, THE API SHALL filtrar os resultados para incluir apenas dados referentes às Wallets presentes em seus Scopes, omitindo silenciosamente as demais.
6. IF um VIEWER não possui nenhum Scope atribuído, THEN THE API SHALL retornar uma lista vazia em endpoints de listagem e negar acesso a qualquer recurso de Wallet com HTTP 403.

### Requisito 9: Gestão de credores

**User Story:** Como um operador, eu quero cadastrar e gerenciar credores, para que eu possa organizar as carteiras de cobrança por origem.

#### Critérios de Aceite

1. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL envia `POST /creditors` com nome (entre 1 e 255 caracteres), THE API SHALL criar o Creditor e retornar HTTP 201.
2. WHEN um usuário autenticado envia `GET /creditors` com parâmetros de paginação, THE API SHALL retornar a lista paginada de credores que não possuam exclusão lógica, com limite padrão de 20 e máximo de 100 registros por página, com suporte a busca case-insensitive parcial por nome e CNPJ.
3. WHEN um usuário autenticado envia `GET /creditors/:id`, THE API SHALL retornar os detalhes do Creditor incluindo nome, CNPJ, contatos e endereço.
4. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL envia `PATCH /creditors/:id`, THE API SHALL atualizar somente os campos nome, CNPJ, contatos e endereço do Creditor.
5. THE API SHALL aceitar CNPJ (exatamente 14 dígitos numéricos com dígito verificador válido), contatos (lista com no máximo 10 entradas contendo tipo e valor) e endereço como campos opcionais do Creditor.
6. IF um usuário autenticado com role VIEWER envia `POST /creditors` ou `PATCH /creditors/:id`, THEN THE API SHALL rejeitar a requisição com HTTP 403 e mensagem indicando permissão insuficiente.
7. IF um usuário autenticado envia `GET /creditors/:id` ou `PATCH /creditors/:id` com um ID inexistente ou soft-deleted, THEN THE API SHALL retornar HTTP 404 com mensagem indicando que o recurso não foi encontrado.
8. IF um usuário autenticado envia `POST /creditors` ou `PATCH /creditors/:id` com CNPJ em formato inválido ou nome vazio, THEN THE API SHALL rejeitar a requisição com HTTP 422 e mensagem indicando os campos com erro de validação.
8b. IF o CNPJ informado já pertence a outro Creditor ativo no sistema, THEN THE API SHALL rejeitar a requisição com HTTP 409 indicando que o CNPJ já está em uso.
9. WHEN um usuário autenticado com role ADMIN envia `DELETE /creditors/:id`, THE API SHALL primeiro verificar se o Creditor possui Wallets com contratos vinculados (critério 10); se não houver impedimento, realizar exclusão lógica do Creditor (atribuindo timestamp a `deletedAt`) e cascatear a exclusão lógica para todas as Wallets vinculadas, mantendo os registros para auditoria, e retornar HTTP 200.
10. IF o Creditor possui Wallets com contratos vinculados, THEN THE API SHALL rejeitar a exclusão com HTTP 409 indicando que existem wallets com contratos que impedem a exclusão.
11. IF um usuário com role OPERATIONAL ou VIEWER envia `DELETE /creditors/:id`, THEN THE API SHALL rejeitar a requisição com HTTP 403.
12. WHILE um usuário possui role VIEWER, THE API SHALL filtrar a listagem de credores para exibir apenas aqueles que possuem ao menos uma Wallet vinculada aos Scopes do usuário.

### Requisito 10: Gestão de carteiras

**User Story:** Como um operador, eu quero criar e gerenciar carteiras vinculadas a credores, para que eu possa agrupar contratos logicamente.

#### Critérios de Aceite

1. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL envia `POST /creditors/:creditorId/wallets` com nome (1 a 120 caracteres após trim), THE API SHALL criar a Wallet com status `ACTIVE` vinculada ao Creditor e retornar HTTP 201.
2. IF o `creditorId` informado não existir ou possuir exclusão lógica (`deletedAt` preenchido), THEN THE API SHALL rejeitar a requisição com HTTP 404.
3. WHEN um usuário autenticado envia `GET /wallets` com paginação (padrão 20 itens por página, máximo 100), THE API SHALL retornar a lista paginada de carteiras que não possuam exclusão lógica, com suporte a busca por nome via substring case-insensitive.
4. WHEN um usuário autenticado envia `GET /wallets/:id`, THE API SHALL retornar os detalhes da Wallet incluindo resumo agregado com: quantidade total de contratos, quantidade de contratos por status e soma total dos valores dos contratos.
4b. IF a Wallet requisitada possuir exclusão lógica (`deletedAt` preenchido), THEN THE API SHALL retornar HTTP 404.
5. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL envia `PATCH /wallets/:id` com campos atualizáveis (nome, status), THE API SHALL atualizar apenas os campos informados, permitindo transição de status entre `ACTIVE` e `INACTIVE`, e retornar HTTP 200.
6. WHILE uma Wallet possui status `INACTIVE`, THE API SHALL rejeitar a associação de novos contratos ou operações a essa Wallet.
7. WHEN um usuário autenticado com role ADMIN envia `DELETE /wallets/:id`, THE API SHALL realizar exclusão lógica (atribuindo timestamp a `deletedAt`), mantendo o registro para auditoria, e retornar HTTP 200.
8. IF um usuário com role OPERATIONAL ou VIEWER envia `DELETE /wallets/:id`, THEN THE API SHALL rejeitar a requisição com HTTP 403 indicando que apenas ADMIN pode excluir carteiras.
9. IF a Wallet possui contratos vinculados (independente do providerStatus), THEN THE API SHALL rejeitar a exclusão com HTTP 409 indicando que a wallet possui contratos e eles devem ser movidos ou excluídos antes.
10. IF um usuário com role VIEWER tenta acessar uma Wallet fora dos escopos atribuídos a ele, THEN THE API SHALL rejeitar a requisição com HTTP 403.

### Requisito 11: Gestão de contratos

**User Story:** Como um operador, eu quero cadastrar e consultar contratos de dívida, para que eu tenha uma base canônica de débitos para gestão e envio a provedores.

#### Critérios de Aceite

1. THE Contract SHALL conter obrigatoriamente: walletId (referência à Wallet), documento do devedor (CPF com 11 ou CNPJ com 14 dígitos numéricos), número do contrato (máximo 100 caracteres), tipo de dívida (conforme enumeração definida no Glossário), data de ocorrência/vencimento (formato ISO 8601, não futura) e valor original (de 0.01 a 999.999.999,99 em BRL).
2. THE Contract SHALL aceitar opcionalmente: valor atualizado (de 0.01 a 999.999.999,99 em BRL, maior ou igual ao valor original), origem de débito (máximo 100 caracteres) e oferta pré-calculada.
3. WHEN um contrato é submetido via API, THE System SHALL aplicar deduplicação usando a DeduplicationKey composta por `creditor + debtor_document_hash + contract_number + debt_origin_document_hash (opcional)`.
3b. THE Contract SHALL pertencer a exatamente uma Wallet (campo `walletId` obrigatório). A relação contrato-wallet é 1:1.
3c. THE API SHALL permitir criação de contratos apenas por usuários com role ADMIN ou OPERATIONAL. IF um VIEWER tentar criar um contrato, THEN THE API SHALL rejeitar com HTTP 403.
3d. WHEN um contrato é criado, THE API SHALL atribuir `providerStatus` inicial igual a `PENDING` e `status` interno igual a `ACTIVE`.
4. WHEN um usuário autenticado envia `GET /contracts` com paginação e filtros (wallet, creditor, status, intervalo de datas, documento do devedor), THE API SHALL retornar contratos não soft-deleted paginados (padrão 20 itens, máximo 100 por página), com o documento do devedor mascarado para o Role VIEWER (exibindo apenas os últimos 4 dígitos) e exibido integralmente para os Roles OPERATIONAL e ADMIN.
5. WHEN um contrato é submetido e já existe registro com a mesma DeduplicationKey, THE API SHALL atualizar todos os campos enviados no registro existente, preservando campos não incluídos na requisição, em vez de criar duplicata.
5b. IF o contrato existente com mesma DeduplicationKey pertence a uma wallet diferente da informada na submissão, THEN THE API SHALL rejeitar a requisição com HTTP 409 indicando que o contrato já existe em outra wallet e deve ser movido explicitamente via PATCH.
6. IF um contrato é submetido com campos obrigatórios ausentes ou com valores fora dos limites definidos, THEN THE API SHALL rejeitar a requisição, retornar uma mensagem de erro indicando os campos inválidos e não persistir nenhum dado.
7. WHEN um usuário autenticado envia `GET /contracts` com filtros que não correspondem a nenhum registro, THE API SHALL retornar uma lista vazia com metadados de paginação zerados.
8. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL envia `PATCH /contracts/:id` e o contrato possui `providerStatus` igual a PENDING, FAILED ou REMOVED, THE API SHALL atualizar os campos editáveis do contrato (valores, datas, tipo de dívida, walletId e status interno) e retornar HTTP 200. Campos não informados no body são preservados. IF o `providerStatus` for diferente desses valores, THEN THE API SHALL rejeitar a requisição com HTTP 409 indicando que o contrato deve ser removido do provedor antes de qualquer alteração.
8b. THE Contract SHALL manter um campo `status` interno com valores: `ACTIVE` (padrão ao criar), `SUSPENDED` (pausado, não elegível para operações de provedor) ou `CANCELLED` (encerrado manualmente). Transições permitidas: ACTIVE↔SUSPENDED, ACTIVE→CANCELLED, SUSPENDED→CANCELLED.
8c. WHILE um contrato possui status interno `SUSPENDED` ou `CANCELLED`, THE API SHALL excluí-lo da seleção de contratos elegíveis ao criar operações de provedor.
8d. IF o PATCH inclui alteração de `walletId` e o contrato possui `providerStatus` diferente de PENDING, FAILED ou REMOVED, THEN THE API SHALL rejeitar a requisição com HTTP 409 indicando status incompatível com movimentação.
8e. IF o PATCH inclui alteração de `walletId` e a wallet de destino não existir ou possuir status INACTIVE, THEN THE API SHALL rejeitar a requisição com HTTP 422 indicando wallet inválida.
9. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL envia `DELETE /contracts/:id` e o contrato possui `providerStatus` igual a PENDING, FAILED ou REMOVED, THE API SHALL realizar exclusão lógica do contrato (atribuindo timestamp a `deletedAt`) e retornar HTTP 200. IF o `providerStatus` for diferente desses valores, THEN THE API SHALL rejeitar a exclusão com HTTP 409 indicando que o contrato deve ser removido do provedor antes de ser excluído.
10. IF um usuário com role VIEWER envia `PATCH /contracts/:id` ou `DELETE /contracts/:id`, THEN THE API SHALL rejeitar a requisição com HTTP 403.
11. THE API SHALL manter um campo `providerStatus` no Contract com os seguintes valores possíveis: `PENDING` (criado, não enviado), `SENT` (enviado ao provedor, aguardando resposta), `REGISTERED` (incluído no Serasa), `UPDATED` (atualizado no Serasa), `FAILED` (falha no envio/registro), `REMOVING` (remoção enviada), `REMOVED` (removido do Serasa), `IN_AGREEMENT` (acordo fechado), `AGREEMENT_BREACHED` (acordo quebrado), `PAID` (acordo pago).
12. THE API SHALL não permitir transições de `providerStatus` via `PATCH /contracts/:id` diretamente; o status é alterado exclusivamente por operações de provedor e webhooks.

### Requisito 12: Tags de contratos

**User Story:** Como um operador, eu quero atribuir tags de texto livre a contratos, para que eu possa filtrar e agrupar contratos por critérios personalizados sem alterar a estrutura de carteiras.

#### Critérios de Aceite

1. WHEN um usuário com role ADMIN ou OPERATIONAL envia `POST /contracts/:id/tags` com uma lista de tags (texto livre, máximo 50 caracteres cada), THE API SHALL vincular as tags ao contrato e retornar HTTP 200.
2. THE API SHALL permitir até 20 tags por contrato. IF o limite for excedido, THEN THE API SHALL rejeitar com HTTP 422.
3. THE API SHALL normalizar tags para lowercase e trim antes de armazenar, tratando tags com mesmo texto normalizado como duplicatas.
4. WHEN um usuário com role ADMIN ou OPERATIONAL envia `DELETE /contracts/:id/tags` com uma lista de tags a remover, THE API SHALL desvincular as tags especificadas do contrato e retornar HTTP 204.
5. WHEN um usuário autenticado envia `GET /contracts` com filtro por tags, THE API SHALL retornar apenas contratos que possuam todas as tags informadas (lógica AND).
6. WHEN um usuário autenticado envia `GET /tags`, THE API SHALL retornar a lista distinta de tags com contagem de contratos por tag. WHILE o usuário possui role VIEWER, THE API SHALL filtrar para incluir apenas tags de contratos pertencentes às Wallets nos Scopes do usuário.
7. IF um usuário com role VIEWER tenta adicionar ou remover tags, THEN THE API SHALL rejeitar a requisição com HTTP 403.

### Requisito 13: Upload e criação de lote de importação

**User Story:** Como um operador, eu quero fazer upload de arquivos CSV ou XLSX com contratos, para que eu possa importar grandes volumes sem cadastro manual.

#### Critérios de Aceite

1. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL envia um arquivo CSV (UTF-8) ou XLSX para `POST /imports` via multipart/form-data junto com `walletId` e o mapeamento de colunas, THE API SHALL criar um ImportBatch associado à wallet informada, armazenar o arquivo em storage compatível com S3, e retornar o identificador do ImportBatch, o status inicial (PENDING_VALIDATION) e o total de linhas detectado no corpo da resposta.
2. IF o arquivo enviado exceder o limite configurável (inicialmente 100 MB), THEN THE API SHALL rejeitar o upload com HTTP 413 e uma mensagem de erro indicando que o tamanho do arquivo excede o limite máximo permitido e informando o limite atual.
3. IF o arquivo enviado não possuir extensão .csv ou .xlsx, ou não for um CSV/XLSX válido, THEN THE API SHALL rejeitar o upload com HTTP 422 e uma mensagem de erro indicando o formato aceito.
4. WHEN o ImportBatch é criado, THE API SHALL armazenar no registro o mapeamento de colunas fornecido na requisição, o total de linhas do arquivo e o status PENDING_VALIDATION.
5. WHEN o upload é concluído com sucesso e o ImportBatch é persistido, THE API SHALL agendar um job de validação via BullMQ_Worker em até 5 segundos após a resposta ao cliente.
6. IF o arquivo enviado contiver apenas cabeçalho e nenhuma linha de dados (0 registros), THEN THE API SHALL rejeitar o upload com HTTP 422 e uma mensagem de erro indicando que o arquivo não contém registros para importação.
7. IF a wallet informada no upload não existir, possuir status INACTIVE ou exclusão lógica, THEN THE API SHALL rejeitar o upload com HTTP 422 indicando wallet inválida.
8. IF um usuário com role VIEWER tenta criar um ImportBatch, THEN THE API SHALL rejeitar a requisição com HTTP 403.

### Requisito 14: Validação e consulta de erros de importação

**User Story:** Como um operador, eu quero consultar o resultado da validação de um lote, para que eu saiba quais linhas têm erros antes de confirmar a importação.

#### Critérios de Aceite

1. WHEN o BullMQ_Worker processa o job de validação, THE API SHALL classificar cada linha como válida ou inválida e atualizar o ImportBatch com contadores de linhas válidas e inválidas.
2. IF existem uma ou mais linhas inválidas ao final da validação, THEN THE API SHALL registrar o status do lote como `VALIDATED_WITH_ERRORS`.
3. WHEN um usuário consulta erros do lote, THE API SHALL retornar uma lista paginada (máximo 50 itens por página) contendo para cada linha inválida: número da linha, código de erro padronizado, nome do campo, mensagem descritiva e valor do campo com mascaramento (exibindo apenas os últimos 4 caracteres) quando o campo for classificado como dado pessoal (CPF, CNPJ ou documento de identificação).
4. IF todas as linhas são válidas ao final da validação, THEN THE API SHALL registrar o status do lote como `VALIDATED`.
5. IF o BullMQ_Worker falha durante o processamento do job de validação, THEN THE API SHALL registrar o status do lote como `VALIDATION_FAILED` e preservar as linhas já processadas com seus respectivos resultados parciais.
5b. WHEN a validação identifica uma linha cuja DeduplicationKey corresponde a um contrato existente com `providerStatus` diferente de PENDING, FAILED ou REMOVED, THE API SHALL marcar a linha como inválida com código de erro PROVIDER_CONFLICT.
5c. WHEN a validação identifica uma linha cuja DeduplicationKey corresponde a um contrato existente em wallet diferente da wallet do batch, THE API SHALL marcar a linha como inválida com código de erro WALLET_MISMATCH.
6. WHEN um usuário autenticado envia `GET /imports/:batchId`, THE API SHALL retornar o status atual do batch, contadores (total, válidas, inválidas, criadas, atualizadas, ignoradas), wallet, credor e timestamps.
7. WHEN um usuário autenticado envia `GET /imports` com paginação, THE API SHALL retornar a lista de batches com filtros por status e wallet. WHILE o usuário possui role VIEWER, THE API SHALL filtrar para exibir apenas batches de wallets presentes nos Scopes do usuário.
8. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL envia `POST /imports/:batchId/cancel` para um batch com status PENDING_VALIDATION, VALIDATING, VALIDATED ou VALIDATED_WITH_ERRORS, THE API SHALL alterar o status para CANCELLED e retornar HTTP 200. IF o status era VALIDATING (job ativo), THE API SHALL sinalizar o cancelamento ao worker; o worker deve verificar o status do batch periodicamente e abortar o processamento de forma graceful ao detectar CANCELLED.
9. IF um usuário tenta cancelar um batch com status APPLYING, APPLIED ou FAILED, THEN THE API SHALL rejeitar com HTTP 409.

### Requisito 15: Confirmação e aplicação de importação

**User Story:** Como um operador, eu quero confirmar a importação de um lote validado, para que os contratos válidos sejam gravados na base.

#### Critérios de Aceite

1. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL confirma um ImportBatch com status `VALIDATED` ou `VALIDATED_WITH_ERRORS`, THE API SHALL alterar o status do batch para `APPLYING` e agendar um job de aplicação via BullMQ_Worker que processa apenas as linhas com resultado de validação válido.
2. WHEN o job de aplicação processa uma linha válida, THE API SHALL aplicar a DeduplicationKey para determinar a ação: criar um novo contrato se nenhum registro existente possuir a mesma chave, atualizar o registro existente se ao menos um campo diferir, ou marcar a linha como IGNORED se a chave já existir e nenhum campo tiver sido alterado.
2b. IF a DeduplicationKey corresponde a um contrato existente com status interno SUSPENDED ou CANCELLED, THEN THE API SHALL atualizar os campos e reativar o contrato (status interno volta para ACTIVE).
3. IF a confirmação é enviada para um batch com status `APPLYING` ou `APPLIED`, THEN THE API SHALL retornar o estado atual do batch sem reagendar o job nem reprocessar linhas.
3b. IF a confirmação é enviada para um batch com status PENDING_VALIDATION, VALIDATING, CANCELLED ou FAILED, THEN THE API SHALL rejeitar com HTTP 409 indicando que o batch não está pronto para confirmação.
4. WHEN o job de aplicação é concluído com sucesso, THE API SHALL atualizar o status do ImportBatch para `APPLIED` e registrar os contadores de linhas criadas, atualizadas e ignoradas.
5. IF o job de aplicação falha durante a execução, THEN THE API SHALL reverter a transação corrente, manter o status do batch como `APPLYING`, e permitir que o mecanismo de retry do BullMQ_Worker reprocesse o job até no máximo 3 tentativas antes de marcar o batch como `FAILED`.

### Requisito 16: Configuração de provedores de cobrança

**User Story:** Como um administrador, eu quero configurar provedores de cobrança externos, para que eu possa enviar contratos para negativação ou cobrança.

#### Critérios de Aceite

1. WHEN um ADMIN cria uma configuração de Provider informando tipo, ambiente e credenciais, THE API SHALL armazenar as credenciais criptografadas em repouso e retornar a configuração criada sem incluir API keys ou segredos em respostas ou logs.
2. THE API SHALL exigir que cada configuração de Provider contenha um ambiente com valor `HOMOLOGATION` ou `PRODUCTION`, rejeitando valores diferentes com erro de validação.
3. WHEN um ADMIN associa uma Wallet local a uma carteira externa do Provider, THE API SHALL persistir o mapeamento entre o ID local e o ID externo.
4. WHEN um usuário consulta a configuração do Provider, THE API SHALL retornar os dados cadastrais (tipo, ambiente, wallet mappings) sem incluir API keys ou segredos.
5. IF o ADMIN tentar criar uma configuração de Provider com campos obrigatórios ausentes ou credenciais inválidas, THEN THE API SHALL rejeitar a requisição com mensagem de erro indicando os campos inválidos, sem persistir dados parciais.
6. IF o ADMIN tentar associar uma Wallet que não existe, THEN THE API SHALL rejeitar a operação com erro indicando que a Wallet é inválida.
7. IF um usuário com role OPERATIONAL ou VIEWER tenta criar ou editar uma configuração de Provider, THEN THE API SHALL rejeitar a requisição com HTTP 403.
7b. THE API SHALL não expor endpoint de exclusão de configuração de Provider no MVP.
8. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL consulta `GET /providers`, THE API SHALL retornar a lista de provedores configurados sem expor credenciais.
9. THE API SHALL permitir no máximo uma configuração por tipo de provedor. IF o ADMIN tentar criar uma segunda configuração para o mesmo tipo, THEN THE API SHALL rejeitar com HTTP 409.
10. IF o ADMIN tentar associar uma Wallet soft-deleted ou INACTIVE a um provedor, THEN THE API SHALL rejeitar com HTTP 422.

### Requisito 17: Criação e execução de operações de provedor

**User Story:** Como um operador, eu quero criar operações que enviem contratos em lotes a um provedor, para que eu possa negativar ou remover débitos em escala.

#### Critérios de Aceite

1. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL cria uma ProviderOperation com ação `CREATE_OR_UPDATE` ou `REMOVE`, THE API SHALL selecionar contratos que pertencem à wallet informada na requisição (que deve estar mapeada ao provedor), não possuem exclusão lógica (`deletedAt` é null), possuem status interno `ACTIVE`, possuem todos os campos obrigatórios para a ação, possuem `providerStatus` elegível (para `CREATE_OR_UPDATE`: PENDING ou FAILED; para `REMOVE`: REGISTERED ou UPDATED) e (para `REMOVE`) possuem um debtId de uma operação anterior bem-sucedida, e dividir o envio em lotes de no máximo 1.000 itens por requisição ao provedor.
2. WHEN uma ProviderOperation é criada, THE API SHALL agendar um job BullMQ para cada lote e retornar a resposta ao cliente em no máximo 3 segundos, sem aguardar resposta do provedor.
3. WHEN o provedor responde com HTTP 202 para um lote, THE API SHALL alterar o status de cada ProviderOperationItem do lote para `WAITING_PROVIDER_EVENT`.
4. IF o provedor responde com status HTTP diferente de 202 ou a requisição falha por timeout, THEN THE API SHALL alterar o status dos ProviderOperationItems do lote para `FAILED`, registrar o código de erro e a mensagem retornada como uma tentativa, e continuar o processamento dos lotes restantes.
5. WHEN todos os lotes de uma ProviderOperation receberam resposta do provedor (202 ou erro), THE API SHALL definir o status da operação como `COMPLETED` se todos os lotes receberam 202, `FAILED` se todos falharam, ou `PARTIALLY_FAILED` se houve combinação. O status final de cada item individual é resolvido posteriormente via webhooks.
6. THE API SHALL permitir consulta paginada das operações, itens, tentativas, IDs externos e erros. WHILE o usuário possui role VIEWER, THE API SHALL filtrar para exibir apenas operações de wallets presentes nos Scopes do usuário.
7. WHEN um usuário autenticado com role ADMIN ou OPERATIONAL envia `POST /operations/:id/cancel` para uma operação com status PENDING ou PROCESSING, THE API SHALL cancelar os jobs enfileirados que ainda não iniciaram, alterar o status da operação para CANCELLED e retornar HTTP 200. Items já enviados ao provedor mantêm seu status individual.
8. IF um usuário com role VIEWER tenta criar ou cancelar uma ProviderOperation, THEN THE API SHALL rejeitar a requisição com HTTP 403.
9. IF a seleção de contratos elegíveis resultar em zero itens, THEN THE API SHALL rejeitar a criação da operação com HTTP 422 indicando que não há contratos elegíveis para a ação solicitada.

### Requisito 18: Integração Serasa LNOP — envio de débitos

**User Story:** Como um operador, eu quero enviar débitos ao Serasa Limpa Nome Parceiros, para que as dívidas sejam incluídas ou removidas na plataforma de negociação.

#### Critérios de Aceite

1. WHEN a ação é `CREATE_OR_UPDATE` e a quantidade de itens é menor ou igual a 1.000, THE API SHALL chamar `POST /debts/create` do Serasa LNOP com Bearer API key enviando todos os itens em uma única requisição.
2. WHEN a ação é `CREATE_OR_UPDATE` e a quantidade de itens excede 1.000, THE API SHALL dividir os itens em lotes de no máximo 1.000 e enviar cada lote como uma requisição `POST /debts/create` separada ao Serasa LNOP.
3. WHEN a ação é `REMOVE`, THE API SHALL chamar `POST /debts/remove` do Serasa LNOP utilizando o `debtId` previamente armazenado no ProviderOperationItem.
4. IF a ação é `REMOVE` e o `debtId` não está armazenado para o item, THEN THE API SHALL marcar o item como falho com indicação de que o débito não possui identificador Serasa e não enviar requisição ao Serasa.
5. WHEN o Serasa responde com HTTP 202, THE API SHALL persistir `transactionId` e `debtId` retornados no ProviderOperationItem.
6. IF o Serasa retorna erro 5xx ou 429, THEN THE API SHALL registrar a tentativa com código de erro e agendar retry com backoff exponencial iniciando em 30 segundos, até no máximo 3 tentativas.
7. IF o Serasa retorna erro 4xx (exceto 429), THEN THE API SHALL registrar a tentativa com código de erro e marcar o item como falho permanente sem agendar retry.
8. THE API SHALL configurar timeout de 30 segundos para cada requisição HTTP ao Serasa. IF a requisição exceder o timeout, THEN THE API SHALL tratar como falha e aplicar a política de retry.

### Requisito 19: Recebimento e processamento de webhooks do Serasa

**User Story:** Como sistema, eu quero receber e processar webhooks do Serasa, para que o status dos débitos seja atualizado automaticamente com base nos eventos da plataforma.

#### Critérios de Aceite

1. WHEN um webhook com assinatura válida é recebido, THE API SHALL persistir o evento no banco de dados e retornar HTTP 200 em até 5 segundos.
2. IF um webhook é recebido com assinatura inválida ou ausente, THEN THE API SHALL rejeitar a requisição com HTTP 401 sem persistir o evento.
3. THE API SHALL aceitar, persistir e processar os eventos: `DebtCreatedEvent`, `DebtRemovedEvent`, `ClosedAgreementEvent`, `BreachedAgreementEvent`, `PaidAgreementEvent` e `PaidInstallmentEvent`.
4. WHEN um `DebtCreatedEvent` com status 201 é recebido, THE API SHALL atualizar o ProviderOperationItem correspondente para status "registered" e o campo de status do provedor no Contract para "registered".
5. WHEN um `DebtCreatedEvent` com status 204 é recebido, THE API SHALL atualizar o ProviderOperationItem correspondente para status "updated".
6. IF um webhook com status 400, 401 ou 500 é recebido, THEN THE API SHALL atualizar o ProviderOperationItem correspondente para status "failed" e persistir o código de erro e mensagem retornados no registro do item.
7. WHEN um webhook duplicado é recebido (mesmo `transactionId` e tipo de evento), THE API SHALL retornar HTTP 200 sem reprocessar o evento.
8. WHEN um `ClosedAgreementEvent`, `BreachedAgreementEvent` ou `PaidAgreementEvent` é recebido, THE API SHALL atualizar o status de negociação do Contract correspondente para refletir o novo estado do acordo (fechado, quebrado ou pago, respectivamente).
9. IF um webhook referencia um `transactionId` que não corresponde a nenhum ProviderOperationItem existente, THEN THE API SHALL persistir o evento com status "unmatched" e retornar HTTP 200.
10. WHEN um `DebtRemovedEvent` com status 200 é recebido, THE API SHALL atualizar o ProviderOperationItem correspondente para status "removed" e o campo `providerStatus` do Contract para `REMOVED`.
11. WHEN um `PaidInstallmentEvent` é recebido, THE API SHALL persistir o evento e incrementar o contador de parcelas pagas no Contract correspondente, sem alterar o `providerStatus`.
12. IF um `DebtRemovedEvent` com status 404, 400, 401 ou 500 é recebido, THEN THE API SHALL marcar o ProviderOperationItem como "failed" e manter o `providerStatus` do Contract como REMOVING.
13. THE API SHALL validar a autenticidade dos webhooks conforme o mecanismo definido na documentação do provedor (ex: assinatura HMAC, token no header). O mecanismo específico será configurado na implementação do adaptador Serasa.
14. THE API SHALL expor o endpoint de webhooks em `POST /webhooks/serasa` (fora do prefixo global `/api`), sem exigir autenticação JWT. A validação de autenticidade é feita exclusivamente via assinatura do provedor conforme critério 13.

### Requisito 20: Auditoria de ações

**User Story:** Como um administrador, eu quero que todas as ações relevantes sejam auditadas, para que eu possa rastrear quem fez o quê e quando.

#### Critérios de Aceite

1. WHEN uma ação de autenticação, alteração administrativa, modificação de dados, importação, operação externa ou processamento de evento ocorrer, THE API SHALL criar uma entrada no log de auditoria em formato JSON estruturado contendo: tipo da ação, userId do ator, tipo do recurso, ID do recurso, timestamp em ISO 8601, requestId e metadata (não-sensível com no máximo 4 KB).
2. THE API SHALL atribuir um `requestId` no formato UUID v4 a cada requisição HTTP no início do processamento e propagá-lo em todos os logs e entradas de auditoria gerados durante a requisição.
3. THE API SHALL atribuir `operationId` (UUID v4) a operações de provedor e `jobId` (UUID v4) a jobs assíncronos, propagando-os em todas as entradas de auditoria associadas à operação ou job.
4. THE API SHALL não incluir dados pessoais (CPF, CNPJ, nomes, e-mails, telefones, senhas), JWTs ou segredos em logs de auditoria ou telemetria, substituindo-os por valores mascarados ou omitindo-os.
5. IF o registro de uma entrada de auditoria falhar, THEN THE API SHALL logar o erro internamente e prosseguir com a operação original (best-effort). A falha de auditoria não deve bloquear operações de negócio.
6. WHEN um usuário autenticado com role ADMIN envia `GET /audit-logs` com filtros (ação, userId, tipo de recurso, resourceId, período), THE API SHALL retornar a lista paginada de entradas de auditoria.
7. IF um usuário com role OPERATIONAL ou VIEWER tenta consultar `GET /audit-logs`, THEN THE API SHALL rejeitar a requisição com HTTP 403.

### Requisito 21: Health checks e observabilidade

**User Story:** Como engenheiro de infraestrutura, eu quero endpoints de saúde, para que eu possa monitorar a disponibilidade e prontidão do serviço.

#### Critérios de Aceite

1. THE API SHALL expor `GET /health/live` que retorna HTTP 200 com um corpo JSON contendo o nome do serviço, a versão e o tempo de atividade em segundos, em no máximo 100ms após o recebimento da requisição.
2. WHEN `GET /health/ready` é chamado e o banco de dados, o Redis e as filas BullMQ respondem a uma verificação dentro de 3 segundos cada, THE API SHALL retornar HTTP 200 com um corpo JSON contendo o nome do serviço, a versão, o tempo de atividade em segundos, o status de cada dependência e métricas básicas das filas (jobs pendentes, ativos e falhos). As métricas de filas são informativas e não afetam o status HTTP retornado.
3. IF o banco de dados ou o Redis não responder à verificação de conectividade dentro de 3 segundos, THEN THE API SHALL retornar HTTP 503 com um corpo JSON indicando quais dependências falharam, sem bloquear a resposta por mais de 5 segundos no total.
4. THE API SHALL não incluir dados pessoais, tokens ou segredos nas respostas dos health checks.
5. THE API SHALL permitir acesso aos endpoints `GET /health/live` e `GET /health/ready` sem exigir autenticação ou autorização.
6. THE API SHALL retornar nas respostas dos health checks apenas campos informativos do serviço (nome, versão, tempo de atividade, status das dependências), sem expor configurações internas, endereços de rede de dependências ou dados de ambiente.

### Requisito 22: Documentação OpenAPI

**User Story:** Como um desenvolvedor front-end, eu quero uma documentação OpenAPI atualizada e gerada automaticamente, para que eu possa integrar com a API de forma confiável.

#### Critérios de Aceite

1. WHEN a aplicação inicializa, THE API SHALL gerar a especificação OpenAPI 3.1 a partir dos decorators do NestJS, disponibilizando-a sem intervenção manual.
2. WHILE a aplicação estiver em ambiente de desenvolvimento ou homologação, THE API SHALL expor a documentação OpenAPI em um endpoint dedicado sem exigir autenticação.
3. WHILE a aplicação estiver em ambiente de produção, THE API SHALL desabilitar o endpoint de documentação OpenAPI ou exigir autenticação para acessá-lo.
4. THE API SHALL descrever na especificação todas as rotas públicas, incluindo: schemas de request e response (DTOs), schemas de erro, esquema de autenticação (Bearer JWT), parâmetros de paginação e valores de enums.
5. IF uma rota pública for adicionada ou modificada sem os decorators de documentação obrigatórios, THEN THE API SHALL exibir um aviso no log de inicialização indicando a rota sem documentação. Testes automatizados devem validar a cobertura de documentação.
