import type {
  Column,
  DatabaseAdapter,
  DatabaseSchema,
  QueryResult,
  RowPage,
  RowPageOptions,
  Table
} from '@/lib/database/types';

/**
 * The database every connection opens in the public demo: a small, read-only
 * store with made-up customers, products and orders. It understands simple
 * SELECT queries (columns, WHERE with AND, ORDER BY, LIMIT, COUNT(*)) and never
 * connects anywhere.
 */

export const DEMO_READ_ONLY_MESSAGE =
  'The sample database is read-only in the demo. Try a SELECT query, e.g. SELECT * FROM orders LIMIT 10;';

type Value = string | number | boolean | null;

interface DemoTable {
  table: Table;
  rows: Record<string, Value>[];
}

function column(name: string, dataType: string, options: Partial<Column> = {}): Column {
  return {
    name,
    dataType,
    nullable: false,
    defaultValue: null,
    isPrimaryKey: false,
    ...options
  };
}

const id = (name = 'id') =>
  column(name, 'integer', { isPrimaryKey: true, defaultValue: 'nextval(...)' });

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 8, 1);
const iso = (days: number) => new Date(BASE + days * DAY).toISOString();

const CUSTOMERS = [
  ['Mara Santos', 'PH'],
  ['Jo Reyes', 'PH'],
  ['Ali Cruz', 'US'],
  ['Sam Lee', 'SG'],
  ['Nina Patel', 'GB'],
  ['Leo Garcia', 'ES'],
  ['Ava Kim', 'KR'],
  ['Omar Haddad', 'AE'],
  ['Zoe Martin', 'FR'],
  ['Ken Tanaka', 'JP'],
  ['Lia Rossi', 'IT'],
  ['Ben Müller', 'DE']
].map(([name, country], index) => ({
  id: index + 1,
  email: `${name.split(' ')[0].toLowerCase()}@example.com`,
  name,
  country,
  created_at: iso(index * 2)
}));

const PRODUCTS = [
  ['TSHIRT-M', 'Acme T-shirt (M)', 24.0, 140, true],
  ['TSHIRT-L', 'Acme T-shirt (L)', 24.0, 96, true],
  ['HOODIE', 'Acme hoodie', 59.0, 41, true],
  ['MUG', 'Ceramic mug', 14.5, 230, false],
  ['STICKERS', 'Sticker pack', 6.0, 812, false],
  ['CAP', 'Embroidered cap', 29.0, 58, true],
  ['BOTTLE', 'Steel bottle', 32.0, 77, false],
  ['TOTE', 'Canvas tote', 19.0, 0, false]
].map(([sku, name, price, stock, featured], index) => ({
  id: index + 1,
  sku: sku as string,
  name: name as string,
  price: price as number,
  stock: stock as number,
  featured: featured as boolean
}));

const STATUSES = ['paid', 'shipped', 'shipped', 'delivered', 'delivered', 'refunded', 'pending'];

const ORDER_ITEMS: Record<string, Value>[] = [];
const ORDERS = Array.from({ length: 24 }, (_, index) => {
  const orderId = index + 1;
  let total = 0;
  const lines = 1 + (index % 3);
  for (let line = 0; line < lines; line++) {
    const product = PRODUCTS[(index * 3 + line * 5) % PRODUCTS.length];
    const quantity = 1 + ((index + line) % 3);
    total += product.price * quantity;
    ORDER_ITEMS.push({
      id: ORDER_ITEMS.length + 1,
      order_id: orderId,
      product_id: product.id,
      quantity,
      price: product.price
    });
  }
  return {
    id: orderId,
    customer_id: (index % CUSTOMERS.length) + 1,
    status: STATUSES[index % STATUSES.length],
    total: Math.round(total * 100) / 100,
    created_at: iso(6 + index)
  };
});

function fk(name: string, from: string, table: string) {
  return {
    name,
    columns: [from],
    referencedSchema: 'public',
    referencedTable: table,
    referencedColumns: ['id']
  };
}

const TABLES: DemoTable[] = [
  {
    table: {
      schema: 'public',
      name: 'customers',
      columns: [
        id(),
        column('email', 'text'),
        column('name', 'text'),
        column('country', 'char(2)'),
        column('created_at', 'timestamptz', { defaultValue: 'now()' })
      ],
      primaryKeys: ['id'],
      foreignKeys: [],
      indexes: [{ name: 'customers_email_key', columns: ['email'], unique: true }]
    },
    rows: CUSTOMERS
  },
  {
    table: {
      schema: 'public',
      name: 'products',
      columns: [
        id(),
        column('sku', 'text'),
        column('name', 'text'),
        column('price', 'numeric(10,2)'),
        column('stock', 'integer', { defaultValue: '0' }),
        column('featured', 'boolean', { defaultValue: 'false' })
      ],
      primaryKeys: ['id'],
      foreignKeys: [],
      indexes: [{ name: 'products_sku_key', columns: ['sku'], unique: true }]
    },
    rows: PRODUCTS
  },
  {
    table: {
      schema: 'public',
      name: 'orders',
      columns: [
        id(),
        column('customer_id', 'integer'),
        column('status', 'text', { defaultValue: "'pending'" }),
        column('total', 'numeric(10,2)'),
        column('created_at', 'timestamptz', { defaultValue: 'now()' })
      ],
      primaryKeys: ['id'],
      foreignKeys: [fk('orders_customer_id_fkey', 'customer_id', 'customers')],
      indexes: [{ name: 'orders_customer_id_idx', columns: ['customer_id'], unique: false }]
    },
    rows: ORDERS
  },
  {
    table: {
      schema: 'public',
      name: 'order_items',
      columns: [
        id(),
        column('order_id', 'integer'),
        column('product_id', 'integer'),
        column('quantity', 'integer', { defaultValue: '1' }),
        column('price', 'numeric(10,2)')
      ],
      primaryKeys: ['id'],
      foreignKeys: [
        fk('order_items_order_id_fkey', 'order_id', 'orders'),
        fk('order_items_product_id_fkey', 'product_id', 'products')
      ],
      indexes: [{ name: 'order_items_order_id_idx', columns: ['order_id'], unique: false }]
    },
    rows: ORDER_ITEMS
  }
];

function findTable(name: string): DemoTable {
  const bare = name.replace(/"/g, '').split('.').pop()?.toLowerCase() ?? '';
  const found = TABLES.find((entry) => entry.table.name === bare);
  if (!found) throw new Error(`relation "${bare}" does not exist`);
  return found;
}

function literal(raw: string): Value {
  const value = raw.trim();
  if (/^'.*'$/.test(value)) return value.slice(1, -1);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^null$/i.test(value)) return null;
  const number = Number(value);
  if (!Number.isNaN(number)) return number;
  throw new Error(`could not understand the value ${value}`);
}

function compare(left: Value, operator: string, right: Value): boolean {
  switch (operator) {
    case '=':
      return left === right || String(left) === String(right);
    case '!=':
    case '<>':
      return String(left) !== String(right);
    case '>':
      return (left ?? 0) > (right ?? 0);
    case '<':
      return (left ?? 0) < (right ?? 0);
    case '>=':
      return (left ?? 0) >= (right ?? 0);
    case '<=':
      return (left ?? 0) <= (right ?? 0);
    case 'like':
    case 'ilike': {
      const pattern = String(right)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*');
      return new RegExp(`^${pattern}$`, operator === 'ilike' ? 'i' : '').test(String(left));
    }
    default:
      throw new Error(`the demo database doesn't support "${operator}"`);
  }
}

/** Runs one simple SELECT against the sample data. */
export function runDemoSelect(sql: string): QueryResult {
  const started = performance.now();
  const statement = sql.trim().replace(/;\s*$/, '');
  const match =
    /^select\s+([\s\S]+?)\s+from\s+([\w."]+)(?:\s+where\s+([\s\S]+?))?(?:\s+order\s+by\s+([\w"]+)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+))?$/i.exec(
      statement
    );
  if (!match) {
    if (/^select\s/i.test(statement)) {
      throw new Error(
        'The demo database understands simple queries: SELECT columns FROM table WHERE … ORDER BY … LIMIT n'
      );
    }
    throw new Error(DEMO_READ_ONLY_MESSAGE);
  }
  const [, selectList, tableName, where, orderBy, direction, limit] = match;
  const { table, rows } = findTable(tableName);
  const columnNames = table.columns.map((entry) => entry.name);
  const known = (name: string) => {
    const bare = name.replace(/"/g, '').split('.').pop() ?? name;
    if (!columnNames.includes(bare)) throw new Error(`column "${bare}" does not exist`);
    return bare;
  };

  let result = rows;
  if (where) {
    const conditions = where.split(/\s+and\s+/i).map((part) => {
      const condition = /^([\w."]+)\s*(=|!=|<>|>=|<=|>|<|ilike|like)\s*(.+)$/i.exec(part.trim());
      if (!condition) throw new Error(`could not understand the condition "${part.trim()}"`);
      return {
        column: known(condition[1]),
        operator: condition[2].toLowerCase(),
        value: literal(condition[3])
      };
    });
    result = result.filter((row) =>
      conditions.every((condition) =>
        compare(row[condition.column], condition.operator, condition.value)
      )
    );
  }
  if (orderBy) {
    const key = known(orderBy);
    const sign = direction?.toLowerCase() === 'desc' ? -1 : 1;
    result = result.toSorted((a, b) => ((a[key] ?? 0) > (b[key] ?? 0) ? sign : -sign));
  }
  if (limit) result = result.slice(0, Number(limit));

  if (/^count\(\s*\*\s*\)$/i.test(selectList.trim())) {
    return {
      columns: ['count'],
      rows: [[result.length]],
      rowCount: 1,
      durationMs: Math.round(performance.now() - started) + 3,
      truncated: false
    };
  }
  const columns =
    selectList.trim() === '*'
      ? columnNames
      : selectList.split(',').map((name) => known(name.trim()));
  return {
    columns,
    rows: result.map((row) => columns.map((name) => row[name])),
    rowCount: result.length,
    durationMs: Math.round(performance.now() - started) + 3,
    truncated: false
  };
}

export function createDemoAdapter(): DatabaseAdapter {
  const readOnly = async () => {
    throw new Error(DEMO_READ_ONLY_MESSAGE);
  };
  return {
    async testConnection() {},
    async listDatabases() {
      return ['acme', 'postgres'];
    },
    async getSchema(): Promise<DatabaseSchema> {
      return { tables: TABLES.map((entry) => entry.table) };
    },
    async execute(sql) {
      return runDemoSelect(sql);
    },
    async fetchRows(_schema, tableName, options: RowPageOptions): Promise<RowPage> {
      const { table, rows } = findTable(tableName);
      const columns = table.columns.map((entry) => entry.name);
      let result = rows;
      const term = options.search?.trim().toLowerCase();
      if (term) {
        const searchColumns = options.searchColumns?.length ? options.searchColumns : columns;
        result = result.filter((row) =>
          searchColumns.some((name) =>
            String(row[name] ?? '')
              .toLowerCase()
              .includes(term)
          )
        );
      }
      const page = result.slice(options.offset, options.offset + options.limit);
      return {
        columns,
        rows: page.map((row) => columns.map((name) => row[name])),
        hasMore: result.length > options.offset + options.limit
      };
    },
    insertRow: readOnly,
    updateRow: readOnly,
    deleteRow: readOnly,
    applyRowChanges: readOnly,
    applyStatements: readOnly,
    async disconnect() {}
  };
}
