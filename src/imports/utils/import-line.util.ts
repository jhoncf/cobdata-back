export interface ImportLineData {
  [key: string]: string;
}

const HEADER_FIELD_MAP: Record<string, string> = {
  'contrato': 'contractNumber',
  'num_adm': 'contractNumber',
  'cliente': 'debtorName',
  'nome_cliente': 'debtorName',
  'documento': 'debtorDocument',
  'mes_contrato': 'occurrenceDate',
  // Layout used by the production portfolio export.  Despite its name, the
  // value is the contract/occurrence date in YYYYMMDD format.
  'm_contrato': 'occurrenceDate',
  'vlr': 'originalValue',
  'valor_divida': 'originalValue',
  'valor_atualizado': 'originalValue',
  'valor_boleto': 'originalValue',
  'vencimento_original': 'dueDate',
  'dt_vencimento': 'dueDate',
  'origem': 'debtOrigin',
  'telefone': 'debtorPhone',
  'telefone_cliente': 'debtorPhone',
  'email': 'debtorEmail',
  'rua': 'debtorStreet',
  'endereco': 'debtorStreet',
  'cidade': 'debtorCity',
  'cep': 'debtorZipCode',
  'uf': 'debtorState',
  'estado': 'debtorState',
  'bairro': 'debtorNeighborhood',
};

/**
 * Some creditor exports contain a single current balance column.  It is both
 * the imported face value and the value currently payable, so retain it in
 * updatedValue as well.  This also makes the contract eligible for Pix
 * issuance without a manual edit after import.
 */
const DUPLICATE_HEADER_FIELD_MAP: Record<string, string> = {
  'valor_divida': 'updatedValue',
  'valor_atualizado': 'updatedValue',
};

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function normalizeColumnMapping(
  columnMapping: Record<string, string>,
  headers: string[],
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(columnMapping)) {
    const keyIsHeader = headers.some((header) => header.trim().toLowerCase() === key.trim().toLowerCase());
    const valueIsHeader = headers.some((header) => header.trim().toLowerCase() === value.trim().toLowerCase());
    if (keyIsHeader && !valueIsHeader) normalized[value] = key;
    else normalized[key] = value;
  }

  for (const header of headers) {
    const normalizedHeader = normalizeHeader(header);
    const targetField = HEADER_FIELD_MAP[normalizedHeader];
    if (targetField && !normalized[targetField]) normalized[targetField] = header;

    const duplicateTargetField = DUPLICATE_HEADER_FIELD_MAP[normalizedHeader];
    if (duplicateTargetField && !normalized[duplicateTargetField]) {
      normalized[duplicateTargetField] = header;
    }
  }

  return normalized;
}

export function normalizeImportLine(line: ImportLineData): ImportLineData {
  const normalized = { ...line };
  for (const field of ['occurrenceDate', 'dueDate', 'cancelledAt']) {
    const value = normalized[field]?.trim();
    if (value && /^\d{8}$/.test(value)) {
      normalized[field] = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    } else if (value && /^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
      const [day, month, year] = value.split('/');
      normalized[field] = `${year}-${month}-${day}`;
    }
  }

  for (const field of ['originalValue', 'updatedValue']) {
    const value = normalized[field]?.trim();
    if (value && /^\d{1,3}(?:\.\d{3})*,\d+$/.test(value)) {
      normalized[field] = value.replace(/\./g, '').replace(',', '.');
    } else if (value && /^\d+,\d+$/.test(value)) {
      normalized[field] = value.replace(',', '.');
    }
  }

  // Some channel templates provide only a due date. Use it as the occurrence
  // reference so a valid contract can still be created and retain the original
  // due date separately.
  if (!normalized.occurrenceDate?.trim() && normalized.dueDate?.trim()) {
    normalized.occurrenceDate = normalized.dueDate;
  }

  const debtType = normalized.debtType?.trim().toUpperCase();
  const debtTypeMap: Record<string, string> = {
    INTERNET: 'TELECOM',
    TELEFONIA: 'TELECOM',
    TELECOMUNICACOES: 'TELECOM',
    ENERGIA: 'UTILITIES',
    AGUA: 'UTILITIES',
    CONDOMINIO: 'CONDOMINIAL',
  };
  normalized.debtType = debtTypeMap[debtType || ''] ?? (debtType || 'OTHER');
  return normalized;
}
