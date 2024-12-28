import { Subject } from 'rxjs';
import type {
    RxStorageInstance,
    RxStorageDefaultCheckpoint,
    RxJsonSchema,
    RxDocumentData,
    StringKeys,
    RxStorageChangeEvent,
    EventBulk,
    BulkWriteRow,
    RxStorageBulkWriteResponse,
    RxStorageQueryResult,
    RxStorageCountResult,
    PreparedQuery,
} from 'rxdb';
import { PGLiteSettings, PGLiteStorageInternals } from './pglite-types';
import { RxStoragePGLite } from './rx-storage-pglite';
import { getPrimaryFieldOfPrimaryKey } from 'rxdb';
import {
    documentToDbFormat,
    dbRowToDocument,
    mangoQueryToSql,
} from './pglite-helper';
import { categorizeBulkWriteRows } from 'rxdb';

export class RxStorageInstancePGLite<RxDocType>
    implements
        RxStorageInstance<
            RxDocType,
            PGLiteStorageInternals<RxDocType>,
            PGLiteSettings,
            RxStorageDefaultCheckpoint
        >
{
    public readonly primaryPath: StringKeys<RxDocumentData<RxDocType>>;
    private changes$: Subject<
        EventBulk<
            RxStorageChangeEvent<RxDocumentData<RxDocType>>,
            RxStorageDefaultCheckpoint
        >
    > = new Subject();
    public closed?: Promise<void>;

    constructor(
        public readonly storage: RxStoragePGLite,
        public readonly databaseName: string,
        public readonly collectionName: string,
        public readonly schema: Readonly<
            RxJsonSchema<RxDocumentData<RxDocType>>
        >,
        public readonly internals: PGLiteStorageInternals<RxDocType>,
        public readonly options: Readonly<PGLiteSettings>
    ) {
        this.primaryPath = getPrimaryFieldOfPrimaryKey(this.schema.primaryKey);
    }

    public async bulkWrite(
        documentWrites: BulkWriteRow<RxDocType>[],
        context: string
    ): Promise<RxStorageBulkWriteResponse<RxDocType>> {
        const ret: RxStorageBulkWriteResponse<RxDocType> = {
            error: [],
        };

        // Get current state of documents
        const docIds = documentWrites.map(
            (writeRow) => writeRow.document[this.primaryPath] as string
        );
        const docsInDb = await this.findDocumentsById(docIds, true);
        const docsMap = new Map<string, RxDocumentData<RxDocType>>();
        docsInDb.forEach((doc) => {
            if (doc) {
                const docId = doc[this.primaryPath] as string;
                docsMap.set(docId, doc);
            }
        });

        // Categorize writes and handle conflicts
        const categorized = categorizeBulkWriteRows<RxDocType>(
            this,
            this.primaryPath as any,
            docsMap,
            documentWrites,
            context
        );

        ret.error = categorized.errors;

        // Process inserts and updates
        for (const writeRow of [
            ...categorized.bulkInsertDocs,
            ...categorized.bulkUpdateDocs,
        ]) {
            try {
                const { id, data } = documentToDbFormat(
                    writeRow.document,
                    this.schema
                );
                if (writeRow.previous) {
                    // Update with revision check
                    try {
                        const jsonData = JSON.stringify(data);
                        const result = await this.internals.db.query(
                            `UPDATE "${this.internals.tableName}" 
                             SET data = $2::jsonb 
                             WHERE id = $1 AND data->>'_rev' = $3
                             RETURNING id`,
                            [id, jsonData, writeRow.previous._rev]
                        );
                        if (result.rows.length === 0) {
                            const currentDoc = docsMap.get(id);
                            if (currentDoc) {
                                ret.error.push({
                                    status: 409,
                                    documentId: id,
                                    writeRow,
                                    documentInDb: currentDoc,
                                    isError: true,
                                });
                            }
                        }
                    } catch (error) {
                        console.error('Error updating document:', error);
                        const currentDoc = docsMap.get(id);
                        if (currentDoc) {
                            ret.error.push({
                                status: 409,
                                documentId: id,
                                writeRow,
                                documentInDb: currentDoc,
                                isError: true,
                            });
                        }
                    }
                } else {
                    // Insert
                    try {
                        const jsonData = JSON.stringify(data);
                        await this.internals.db.query(
                            `INSERT INTO "${this.internals.tableName}" (id, data) 
                             VALUES ($1, $2::jsonb)`,
                            [id, jsonData]
                        );
                    } catch (error) {
                        console.error('Error inserting document:', error);
                        const existingDoc = docsMap.get(id);
                        if (existingDoc) {
                            ret.error.push({
                                status: 409,
                                documentId: id,
                                writeRow,
                                documentInDb: existingDoc,
                                isError: true,
                            });
                        }
                    }
                }
            } catch (error) {
                const docId = writeRow.document[this.primaryPath] as string;
                const docInDb = docsMap.get(docId);
                if (docInDb) {
                    ret.error.push({
                        status: 409,
                        documentId: docId,
                        writeRow,
                        documentInDb: docInDb,
                        isError: true,
                    });
                }
            }
        }

        // Emit changes if any
        if (categorized.eventBulk.events.length > 0 && categorized.newestRow) {
            const lastState = categorized.newestRow.document;
            categorized.eventBulk.checkpoint = {
                id: lastState[this.primaryPath] as string,
                lwt: lastState._meta.lwt,
            };
            this.changes$.next(categorized.eventBulk);
        }

        return ret;
    }

    public async findDocumentsById(
        docIds: string[],
        withDeleted: boolean
    ): Promise<RxDocumentData<RxDocType>[]> {
        const query = `
            SELECT id, data FROM ${this.internals.tableName}
            WHERE id = ANY($1)
            ${!withDeleted ? "AND (data->'_deleted')::boolean = false" : ''}
        `;
        const result = await this.internals.db.query(query, [docIds]);
        return result.rows.map((row) =>
            dbRowToDocument<RxDocType>(
                row as { id: string; data: RxDocumentData<RxDocType> }
            )
        );
    }

    public async query(
        preparedQuery: PreparedQuery<RxDocType>
    ): Promise<RxStorageQueryResult<RxDocType>> {
        const { sql, params } = mangoQueryToSql(preparedQuery.query);
        const skip = preparedQuery.query.skip || 0;
        const limit = preparedQuery.query.limit;
        const sort = preparedQuery.query.sort;
        const query = `
            SELECT id, data FROM "${this.internals.tableName}"
            ${sql}
            ${
                sort && Array.isArray(sort) && sort.length > 0
                    ? `ORDER BY ${sort
                          .map((sortObj) => {
                              if (!sortObj || typeof sortObj !== 'object')
                                  return '';
                              const keys = Object.keys(sortObj);
                              if (keys.length === 0) return '';
                              const field = keys[0];
                              const direction = String(
                                  sortObj[field as keyof typeof sortObj]
                              ).toUpperCase();
                              if (direction !== 'ASC' && direction !== 'DESC')
                                  return '';
                              return `data->>'${field}' ${direction}`;
                          })
                          .filter(Boolean)
                          .join(', ')}`
                    : ''
            }
            ${skip ? `OFFSET ${skip}` : ''}
            ${limit ? `LIMIT ${limit}` : ''}
        `;
        const result = await this.internals.db.query(query, params);
        return {
            documents: result.rows.map((row) =>
                dbRowToDocument<RxDocType>(
                    row as { id: string; data: RxDocumentData<RxDocType> }
                )
            ),
        };
    }

    public async count(
        preparedQuery: PreparedQuery<RxDocType>
    ): Promise<RxStorageCountResult> {
        const { sql, params } = mangoQueryToSql(preparedQuery.query);
        const query = `
            SELECT COUNT(*) as count FROM ${this.internals.tableName}
            ${sql}
        `;
        const result = await this.internals.db.query(query, params);
        return {
            count: parseInt((result.rows[0] as { count: string }).count, 10),
            mode: 'fast',
        };
    }

    public async cleanup(minimumDeletedTime: number): Promise<boolean> {
        const query = `
            DELETE FROM ${this.internals.tableName}
            WHERE (data->>'_deleted')::boolean = true
            AND (data->>'_meta'->>'deletedAt')::bigint <= $1
        `;
        await this.internals.db.query(query, [minimumDeletedTime]);
        return true;
    }

    public async getAttachmentData(
        documentId: string,
        attachmentId: string,
        digest: string
    ): Promise<string> {
        throw new Error('Attachments are not supported in PGLite storage');
    }

    public changeStream(): Subject<
        EventBulk<
            RxStorageChangeEvent<RxDocumentData<RxDocType>>,
            RxStorageDefaultCheckpoint
        >
    > {
        return this.changes$;
    }

    public async remove(): Promise<void> {
        await this.internals.db.query(
            `DROP TABLE IF EXISTS ${this.internals.tableName}`
        );
        this.closed = Promise.resolve();
    }

    public async close(): Promise<void> {
        if (this.closed) {
            await this.closed;
        }
        this.changes$.complete();
    }
}
