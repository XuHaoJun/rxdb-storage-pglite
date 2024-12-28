import type { RxStorage, RxStorageInstanceCreationParams } from 'rxdb';
import { PGLiteSettings, PGLiteStorageInternals } from './pglite-types';
import { RxStorageInstancePGLite } from './rx-storage-instance';
import { newRxError } from 'rxdb';
import { RXDB_VERSION } from 'rxdb/plugins/utils';
import { ensureCollectionTable } from './pglite-helper';

// Add IDBFactory type for TypeScript
type IDBFactory = any;

declare const window: {
    indexedDB: IDBFactory | null;
} & typeof globalThis;

/**
 * Detects if code is running in Node.js or browser environment
 */
function isNodeJS(): boolean {
    return (
        typeof process !== 'undefined' &&
        process.versions != null &&
        process.versions.node != null
    );
}

/**
 * Checks if IndexedDB is supported in the current environment
 */
function isIndexedDBSupported(): boolean {
    try {
        return (
            typeof window !== 'undefined' &&
            'indexedDB' in window &&
            window.indexedDB !== null
        );
    } catch (e) {
        return false;
    }
}

/**
 * Normalizes the database path based on environment
 */
function normalizePath(path: string): string {
    if (isNodeJS()) {
        return path;
    } else {
        // For browser, check IndexedDB support first
        if (!isIndexedDBSupported()) {
            return path;
        }
        // Ensure path starts with idb:// if not already
        if (!path.startsWith('idb://')) {
            return `idb://${path}`;
        }
        return path;
    }
}

export class RxStoragePGLite
    implements RxStorage<PGLiteStorageInternals<any>, PGLiteSettings>
{
    public readonly name = 'pglite';
    public readonly rxdbVersion = RXDB_VERSION;

    constructor(public settings: PGLiteSettings = { path: './db.pglite' }) {
        if (!this.settings.disableNormalizePath) {
            this.settings.path = normalizePath(settings.path);
        }
    }

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
