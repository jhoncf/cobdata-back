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

/**
 * Converts the currency formats normally found in creditor exports into a
 * JavaScript-compatible decimal string.  The import receives both Brazilian
 * (R$ 1.234,56) and international (R$ 1,234.56 / R$ 1234.56) layouts.
 */
function normalizeCurrencyValue(value: string): string {
  const numeric = value.replace(/[^0-9,.-]/g, '');
  if (!numeric) return value;

  const lastComma = numeric.lastIndexOf(',');
  const lastDot = numeric.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);

  // A final separator followed by one or two digits is the decimal marker.
  // All earlier separators are thousands markers and must be discarded.
  if (decimalIndex >= 0 && numeric.length - decimalIndex - 1 <= 2) {
    const integerPart = numeric.slice(0, decimalIndex).replace(/[.,]/g, '');
    const decimalPart = numeric.slice(decimalIndex + 1).replace(/[.,]/g, '');
    return `${integerPart}.${decimalPart}`;
  }

  // A separator followed by three digits is a thousands marker (e.g. 1.234).
  return numeric.replace(/[.,]/g, '');
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
    if (value) normalized[field] = normalizeCurrencyValue(value);
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
