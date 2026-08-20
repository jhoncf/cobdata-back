# Requisitos — Canais e Estratégias de Cobrança

## Objetivo

Executar ações de cobrança concorrentes sobre contratos de uma carteira, começando por Serasa. A arquitetura deve permitir o canal CobCom (e-mail com estratégia própria), medir resultados por canal e mover contratos entre carteiras conforme eventos de negociação.

## Conceitos

- **Canal**: meio de relacionamento/cobrança, como Serasa ou CobCom.
- **CobCom**: canal próprio de comunicação, com estratégia, templates, regras e métricas independentes.
- **Modalidade CobCom**: meio de contato dentro do canal CobCom: `EMAIL`, `WHATSAPP` ou `SMS`.
- **Meio de pagamento**: emissor do instrumento de pagamento, como Banco do Brasil/Pix. Não é um canal.
- **Estratégia**: regras que escolhem contratos, canais e sequência de ações.
- **Operação**: execução de uma estratégia sobre uma carteira.
- **Ação de canal**: despacho individual de um contrato para um canal.
- **Atribuição**: canal ao qual um pagamento é associado para fins de mensuração.

## Requirements

### Requirement 1: Canais habilitados por carteira

1. Cada carteira deve permitir selecionar vários canais habilitados, incluindo `SERASA` e `COBCOM`.
2. A primeira entrega exibe apenas Serasa no seletor e executa somente o fluxo Serasa já existente. CobCom permanece no modelo e na seleção futura, mas não dispara ação automática nesta fase.
3. Desabilitar um canal em uma carteira impede novos despachos, sem apagar histórico ou interromper cobranças já emitidas.
4. A configuração de canais não seleciona meio de pagamento. Um canal pode solicitar Pix por meio de um Payment Gateway no futuro.

### Requirement 2: Operação multicanal concorrente

1. Na fase atual, ao iniciar uma operação, o sistema deve manter o envio existente ao Serasa.
2. Em fase futura, a operação-pai criará uma ação independente para cada par contrato/canal elegível e poderá executá-las concorrentemente; a falha de um canal não poderá impedir os demais.
3. O modelo deve permitir que um contrato esteja ativo simultaneamente no Serasa e em outros canais, sem ativar novos despachos automáticos nesta fase.
4. O status de um contrato no Serasa não pode ser usado como status global de todos os canais. Cada ação deve manter seu próprio estado, tentativas, referência externa e erro.
5. A operação-pai deve consolidar total, processados, falhos e resultados por canal, sem ocultar falhas parciais.

### Requirement 3: Pagamento e atribuição de canal

1. Uma liquidação deve registrar separadamente `paymentProvider` (por exemplo, Banco do Brasil), `attributedChannel` (por exemplo, EMAIL) e a ação/campanha que originou o pagamento quando disponível.
2. Quando o CobCom gerar um Pix por e-mail, WhatsApp ou SMS para o contrato, a cobrança e a liquidação devem ser atribuídas ao canal `COBCOM`, registrando também a modalidade CobCom que originou a ação, mesmo que o pagamento seja processado pelo Banco do Brasil.
3. Pagamentos advindos do Serasa devem ser atribuídos a `SERASA` usando a referência de operação/evento retornada pela API.
4. Toda atribuição deve ser auditável e não pode ser alterada silenciosamente; correções devem gerar evento de ajuste com responsável.
5. Pix emitido manualmente no CRM ou pelo endpoint de geração direta deve ser atribuído a `MANUAL_CRM`, sem ser contabilizado como resultado de CobCom até que uma ação CobCom rastreável o origine.

### Requirement 4: Métricas por canal e estratégia

1. O sistema deve medir, por intervalo, carteira, estratégia e canal: contratos elegíveis, enviados, entregues quando aplicável, visualizados/clicados quando aplicável, Pix gerados, acordos, pagamentos, valor pago, acordos quebrados e taxa de conversão. Para CobCom, as métricas devem também ser segmentáveis por modalidade (`EMAIL`, `WHATSAPP`, `SMS`).
2. A primeira regra de atribuição deve ser **origem direta**: um Pix criado por uma ação de canal atribui o pagamento àquela ação. Eventos Serasa são atribuídos ao Serasa.
3. O sistema deve preservar eventos brutos e projeções diárias para permitir comparar, por exemplo, duas semanas de Serasa contra outro canal.

### Requirement 5: Transição de carteira por evento

1. Uma estratégia deve poder definir regra de transição: ao ocorrer `AGREEMENT_BREACHED`, mover o contrato para uma carteira de destino e habilitar a estratégia/canais dela.
2. A movimentação deve ser transacional, auditada e preservar o histórico completo de carteira, canais, operações, acordos e pagamentos anteriores.
3. A transição não pode duplicar o contrato nem reenviar automaticamente para um canal sem respeitar as regras de elegibilidade da carteira de destino.

### Requirement 6: Segurança e consistência

1. Canais futuros que consultam CPF ou geram Pix devem usar credencial de integração própria, rate limit e identificação de origem.
2. Cada ação e evento deve ser idempotente por contrato, canal e referência externa.
3. VIEWER somente consulta dados das carteiras permitidas; ADMIN e OPERATIONAL iniciam operações conforme permissões existentes; apenas ADMIN configura estratégias e canais.

### Requirement 7: Estratégia Serasa e política de acordo

1. Os parâmetros regulares de acordo Serasa - multa, juros, desconto e matriz por atraso/parcelas - são configurados na carteira externa do Portal Limpa Nome Parceiros, não no endpoint de envio de dívida.
2. O CRM deve registrar a estratégia Serasa aplicada para visibilidade e métricas, sem assumir que sua edição sincroniza automaticamente a política no Portal Serasa.
3. Quando uma oferta pré-calculada for usada no envio da dívida, ela deve limitar-se aos campos suportados pela API: valor total da oferta, dias até o primeiro vencimento e máximo de parcelas.
4. Ao receber `ClosedAgreementEvent`, o sistema deve preservar o snapshot do acordo: valor, quantidade de parcelas, vencimento e valor de cada parcela, desconto, juros e multa. Esse snapshot é a fonte do valor para eventos posteriores de pagamento de parcela que não tragam valor explícito.

## Fora de escopo da primeira entrega

- Implementação do canal CobCom, incluindo e-mail, WhatsApp, SMS, templates, provedores de envio e disparos automáticos.
- Atribuição probabilística ou multi-touch; a primeira versão usa origem direta.
- Migração automática por qualquer evento além de quebra de acordo.
