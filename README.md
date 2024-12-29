# RxDB PgLite

This is a plugin for [RxDB](https://rxdb.info/) that allows you to use [PgLite](https://github.com/electric-sql/pglite) as a storage engine.

## Installation

```bash
npm install @xuhaojun/rxdb-storage-pglite @electric-sql/pglite
```

## Usage

```typescript
import { getRxStoragePGLite } from "@xuhaojun/rxdb-storage-pglite";

// nodejs with local file storage
const myDatabase = await createRxDatabase<YourCollections>({
    name: "test",
    storage: getRxStoragePGLite({ path: path.join(__dirname, "test.db") }),
});

// browser with indexedDB storage
const myDatabase = await createRxDatabase<YourCollections>({
    name: "test",
    storage: getRxStoragePGLite({ path: "idb://test" }),
});

// expo with expo-file-system
import * as FileSystem from "expo-file-system";
const myDatabase = await createRxDatabase<YourCollections>({
    name: "test",
    storage: getRxStoragePGLite({
        path: FileSystem.documentDirectory + "test.db",
    }),
});
```
