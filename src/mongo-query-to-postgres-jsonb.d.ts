declare module 'mongo-query-to-postgres-jsonb' {
    function mToPsql(column: string, query: any): string;
    export = mToPsql;
} 