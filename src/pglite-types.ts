import type {
    RxStorage,
    RxStorageInstanceCreationParams,
    RxDocumentData,
    RxJsonSchema,
} from 'rxdb';
import type { PGlite } from '@electric-sql/pglite';

export type PGLiteSettings = {
    /**
     * The database file path
     */
    path: string;
    /**
     * If true, the database will be created if it doesn't exist
     */
    autoCreate?: boolean;
    /**
     * If true, the database will be opened in read-only mode
     */
    readonly?: boolean;

    disableNormalizePath?: boolean;
};

export type PGLiteStorageInternals<RxDocType> = {
    /**
     * The database instance
     */
    db: PGlite; // TODO: Replace with proper PGLite type
    /**
     * The table name for this collection
     */
    tableName: string;
    /**
     * Schema of the collection
     */
    schema: RxJsonSchema<RxDocumentData<RxDocType>>;
    /**
     * Documents in the collection
     */
    documents: Map<string, RxDocumentData<RxDocType>>;
};

export type RxStoragePGLite = RxStorage<
    PGLiteStorageInternals<any>,
    PGLiteSettings
>;

export type RxStoragePGLiteInstanceCreationParams<RxDocType> =
    RxStorageInstanceCreationParams<RxDocType, PGLiteSettings>;
