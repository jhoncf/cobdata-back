# Diretrizes de processamento de planilhas

## Planilhas grandes são o padrão

Toda importação, exportação, conferência ou remoção em massa deve ser projetada
para arquivos grandes. Não assuma que o arquivo cabe confortavelmente em
memória nem que uma requisição HTTP síncrona terminará em poucos segundos.

- Leia e retenha somente as colunas necessárias para cada etapa.
- Processe registros em lotes e prefira filas para operações que alteram muitos
  contratos.
- Ofereça prévia, contagem e progresso sem bloquear a interface.
- Defina limites explícitos e mensagens compreensíveis quando houver limites.
- Evite materializar planilhas completas ou repetir o mesmo parse sem
  necessidade.
