import type {
    RxDocumentData,
    MangoQuery,
    MangoQuerySelector,
    RxJsonSchema,
} from 'rxdb';
import { getComposedPrimaryKeyOfDocumentData } from 'rxdb';
import mToPsql from 'mongo-query-to-postgres-jsonb';

/**
 * Creates a table for the collection if it doesn't exist
 */
export async function ensureCollectionTable(
    db: any,
    tableName: string,
    schema: RxJsonSchema<any>
): Promise<void> {
    try {
        // Create the table with proper JSONB type
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS "${tableName}" (
                id TEXT PRIMARY KEY,
                data JSONB NOT NULL DEFAULT '{}'::jsonb
            )
        `;
        await db.query(createTableQuery);

        // Create an index on the data column for better query performance
        const createIndexQuery = `
            CREATE INDEX IF NOT EXISTS "${tableName}_data_idx" ON "${tableName}" USING gin (data)
        `;
        await db.query(createIndexQuery);
    } catch (error) {
        console.error('Error creating table:', error);
        throw error;
    }
}

/**
 * @deprecated
 * Converts a Mango query to SQL WHERE clause
 */
export function mangoQueryToSqlOld(query: MangoQuery<any>): {
    sql: string;
    params: any[];
} {
    function processSelector(selector: any): {
        condition: string;
        params: any[];
    } {
        const conditions: string[] = [];
        const params: any[] = [];

        Object.entries(selector).forEach(([field, value]) => {
            if (field.startsWith('$')) {
                // Logical operators
                switch (field) {
                    case '$and':
                        const andResults = (value as any[]).map((s) =>
                            processSelector(s)
                        );
                        conditions.push(
                            `(${andResults
                                .map((r) => r.condition)
                                .join(' AND ')})`
                        );
                        andResults.forEach((r) => params.push(...r.params));
                        break;
                    case '$or':
                        const orResults = (value as any[]).map((s) =>
                            processSelector(s)
                        );
                        conditions.push(
                            `(${orResults
                                .map((r) => r.condition)
                                .join(' OR ')})`
                        );
                        orResults.forEach((r) => params.push(...r.params));
                        break;
                    case '$not':
                        const notResult = processSelector(value);
                        conditions.push(`NOT (${notResult.condition})`);
                        params.push(...notResult.params);
                        break;
                    case '$nor':
                        const norResults = (value as any[]).map((s) =>
                            processSelector(s)
                        );
                        conditions.push(
                            `NOT (${norResults
                                .map((r) => r.condition)
                                .join(' OR ')})`
                        );
                        norResults.forEach((r) => params.push(...r.params));
                        break;
                }
            } else if (typeof value === 'object') {
                Object.entries(value as MangoQuerySelector<any>).forEach(
                    ([op, val]) => {
                        switch (op) {
                            case '$eq':
                                if (typeof val === 'boolean') {
                                    conditions.push(
                                        `data->'${field}' = $${
                                            params.length + 1
                                        }::jsonb`
                                    );
                                } else {
                                    conditions.push(
                                        `data->>'${field}' = $${
                                            params.length + 1
                                        }`
                                    );
                                }
                                params.push(val);
                                break;
                            case '$gt':
                                conditions.push(
                                    `(data->>'${field}')::numeric > $${
                                        params.length + 1
                                    }`
                                );
                                params.push(val);
                                break;
                            case '$gte':
                                conditions.push(
                                    `(data->>'${field}')::numeric >= $${
                                        params.length + 1
                                    }`
                                );
                                params.push(val);
                                break;
                            case '$lt':
                                conditions.push(
                                    `(data->>'${field}')::numeric < $${
                                        params.length + 1
                                    }`
                                );
                                params.push(val);
                                break;
                            case '$lte':
                                conditions.push(
                                    `(data->>'${field}')::numeric <= $${
                                        params.length + 1
                                    }`
                                );
                                params.push(val);
                                break;
                            case '$ne':
                                if (typeof val === 'boolean') {
                                    conditions.push(
                                        `data->'${field}' != $${
                                            params.length + 1
                                        }::jsonb`
                                    );
                                } else {
                                    conditions.push(
                                        `data->>'${field}' != $${
                                            params.length + 1
                                        }`
                                    );
                                }
                                params.push(val);
                                break;
                            case '$in':
                                conditions.push(
                                    `data->>'${field}' IN (${(val as any[])
                                        .map(() => `$${params.length + 1}`)
                                        .join(',')})`
                                );
                                params.push(...(val as any[]));
                                break;
                            case '$nin':
                                conditions.push(
                                    `data->>'${field}' NOT IN (${(val as any[])
                                        .map(() => `$${params.length + 1}`)
                                        .join(',')})`
                                );
                                params.push(...(val as any[]));
                                break;
                            case '$exists':
                                conditions.push(
                                    val
                                        ? `data ? '${field}'`
                                        : `NOT (data ? '${field}')`
                                );
                                break;
                            case '$type':
                                conditions.push(
                                    `jsonb_typeof(data->'${field}') = $${
                                        params.length + 1
                                    }`
                                );
                                params.push(val);
                                break;
                            case '$all':
                                conditions.push(
                                    `data->'${field}' @> $${
                                        params.length + 1
                                    }::jsonb`
                                );
                                params.push(JSON.stringify(val));
                                break;
                            case '$elemMatch':
                                const elemResult = processSelector(val);
                                conditions.push(`EXISTS (
                                SELECT 1 FROM jsonb_array_elements(data->'${field}') elem
                                WHERE ${elemResult.condition.replace(
                                    /data->>/g,
                                    'elem->>'
                                )}
                            )`);
                                params.push(...elemResult.params);
                                break;
                        }
                    }
                );
            } else {
                conditions.push(`data->>'${field}' = $${params.length + 1}`);
                params.push(value);
            }
        });

        return {
            condition: conditions.join(' AND '),
            params,
        };
    }

    const { condition, params } = processSelector(query.selector || {});
    const sql = condition ? `WHERE ${condition}` : '';
    return { sql, params };
}

/**
 * Alternative implementation of mangoQueryToSql using mongo-query-to-postgres-jsonb
 */
export function mangoQueryToSql(query: MangoQuery<any>): {
    sql: string;
    params: any[];
} {
    const result = mToPsql('data', query.selector || {});
    return {
        sql: result ? `WHERE ${result}` : '',
        params: [],
    };
}

/**
 * Converts document data to database format
 */
export function documentToDbFormat<RxDocType>(
    docData: RxDocumentData<RxDocType>,
    schema: RxJsonSchema<RxDocType>
): { id: string; data: any } {
    return {
        id: getComposedPrimaryKeyOfDocumentData(schema, docData),
        data: docData,
    };
}

/**
 * Converts database row to document format
 */
export function dbRowToDocument<RxDocType>(row: {
    id: string;
    data: any;
}): RxDocumentData<RxDocType> {
    return row.data;
}
