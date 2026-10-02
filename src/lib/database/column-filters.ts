import { likePattern, type DatabaseProviderName } from '@/lib/database/types';

export const FILTER_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'isNull',
  'isNotNull'
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** One column filter from the grid's header; values stay strings and are always bound. */
export interface ColumnFilter {
  column: string;
  operator: FilterOperator;
  value?: string;
  /** Upper bound for `between`. */
  valueTo?: string;
}

export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  eq: '=',
  neq: '≠',
  contains: 'contains',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'between',
  isNull: 'is NULL',
  isNotNull: 'is not NULL'
};

const COMPARISON: Partial<Record<FilterOperator, string>> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<='
};

/**
 * One SQL condition per filter. `bind` registers a value and returns its
 * placeholder, so every value reaches the database as a parameter.
 */
export function columnFilterConditions(
  provider: DatabaseProviderName,
  filters: ColumnFilter[],
  bind: (value: unknown) => string
): string[] {
  const ident = (name: string) =>
    provider === 'MYSQL' ? `\`${name.replaceAll('`', '``')}\`` : `"${name.replaceAll('"', '""')}"`;

  return filters.map(({ column, operator, value = '', valueTo = '' }) => {
    const target = ident(column);
    switch (operator) {
      case 'isNull':
        return `${target} IS NULL`;
      case 'isNotNull':
        return `${target} IS NOT NULL`;
      case 'contains':
        return provider === 'MYSQL'
          ? `CAST(${target} AS CHAR) LIKE ${bind(likePattern(value))}`
          : `${target}::text ILIKE ${bind(likePattern(value))}`;
      case 'between':
        return `${target} BETWEEN ${bind(value)} AND ${bind(valueTo)}`;
      default:
        return `${target} ${COMPARISON[operator]} ${bind(value)}`;
    }
  });
}

/** How a column's values are picked in the grid: a date-time picker, a date picker, or text. */
export type ValueKind = 'datetime' | 'date' | 'boolean' | 'text';

export function valueKindOf(dataType: string): ValueKind {
  const type = dataType.toLowerCase();
  if (type.includes('timestamp') || type.includes('datetime')) return 'datetime';
  if (type === 'date') return 'date';
  if (type.includes('bool')) return 'boolean';
  return 'text';
}
