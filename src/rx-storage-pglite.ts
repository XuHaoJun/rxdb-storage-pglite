import type { RxStorage, RxStorageInstanceCreationParams } from 'rxdb';
import { PGLiteSettings, PGLiteStorageInternals } from './pglite-types';
import { RxStorageInstancePGLite } from './rx-storage-instance';
import { newRxError } from 'rxdb';
import { RXDB_VERSION } from 'rxdb/plugins/utils';
import { ensureCollectionTable } from './pglite-helper';

export class RxStoragePGLite
    implements RxStorage<PGLiteStorageInternals<any>, PGLiteSettings>
{
    public readonly name = 'pglite';
    public readonly rxdbVersion = RXDB_VERSION;

    constructor(public settings: PGLiteSettings = { path: './db.pglite' }) {}

    public async createStorageInstance<RxDocType>(
        params: RxStorageInstanceCreationParams<RxDocType, PGLiteSettings>
    ) {
        if (!params.schema.primaryKey) {
            throw newRxError('SC30', { schema: params.schema });
        }

        if (typeof params.schema.version !== 'number') {
            throw newRxError('SC30', { schema: params.schema });
        }

        const { PGlite } = await import('@electric-sql/pglite');
        const db = new PGlite(this.settings.path);
        await db.waitReady;

        const tableName = `${params.databaseName}_${params.collectionName}_${params.schema.version}`;
        await ensureCollectionTable(db, tableName, params.schema);

        const instance = new RxStorageInstancePGLite(
            this,
            params.databaseName,
            params.collectionName,
            params.schema,
            {
                db,
                tableName,
                schema: params.schema,
                documents: new Map(),
            },
            params.options
        );

        return instance;
    }
}

export function getRxStoragePGLite(settings: PGLiteSettings) {
    const storage = new RxStoragePGLite(settings);
    return storage;
}
