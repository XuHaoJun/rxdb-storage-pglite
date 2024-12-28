import fs from 'fs';
import { addRxPlugin, createRxDatabase, type RxCollection } from 'rxdb';
import { getRxStoragePGLite } from '../src';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Add Jest imports
import { beforeEach, afterEach, test, expect } from '@jest/globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

addRxPlugin(RxDBQueryBuilderPlugin);

interface TodoDocType {
    id: string;
    name: string;
    done: boolean;
    timestamp: string;
}

interface TodoCollections {
    todos: RxCollection<TodoDocType>;
}

const testDir = join(__dirname, 'test-dbs');
const todoListTestDbPath = join(testDir, 'todo-list-test.db');
const complexQueriesTestDbPath = join(testDir, 'complex-queries-test.db');
const paginationTestDbPath = join(testDir, 'pagination-test.db');

// Add delay helper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Add database cleanup helper
async function cleanupDatabase(path: string) {
    if (fs.existsSync(path)) {
        try {
            await delay(100); // Give time for connections to close
            fs.rmSync(path, { recursive: true, force: true });
        } catch (err) {
            console.warn(`Warning: Could not remove database at ${path}:`, err);
        }
    }
}

beforeEach(async () => {
    // Create test directory if it doesn't exist
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }

    // Clean up existing databases
    await Promise.all(
        [
            todoListTestDbPath,
            complexQueriesTestDbPath,
            paginationTestDbPath,
        ].map(cleanupDatabase)
    );

    // Add a small delay after cleanup
    await delay(500);
});

afterEach(async () => {
    // Add a small delay before cleanup
    await delay(500);
    await Promise.all(
        [
            todoListTestDbPath,
            complexQueriesTestDbPath,
            paginationTestDbPath,
        ].map(cleanupDatabase)
    );
});

async function createTestDatabase<T>(name: string, path: string) {
    let retries = 3;
    let lastError;

    while (retries > 0) {
        try {
            const db = await createRxDatabase<T>({
                name,
                storage: getRxStoragePGLite({
                    path,
                    autoCreate: true,
                    disableNormalizePath: true,
                }),
            });
            return db;
        } catch (error) {
            lastError = error;
            console.warn(
                `Attempt ${4 - retries} failed for database ${name}:`,
                error
            );
            retries--;
            if (retries > 0) {
                await delay(1000); // Wait before retrying
                await cleanupDatabase(path); // Clean up before retry
                await delay(500); // Wait after cleanup
            }
        }
    }
    throw lastError;
}

test('todo list test', async () => {
    const myDatabase = await createTestDatabase<TodoCollections>(
        'test0',
        todoListTestDbPath
    );
    const todoSchema = {
        version: 0,
        primaryKey: 'id',
        type: 'object',
        properties: {
            id: {
                type: 'string',
                maxLength: 100,
            },
            name: {
                type: 'string',
            },
            done: {
                type: 'boolean',
            },
            timestamp: {
                type: 'string',
                format: 'date-time',
            },
        },
        required: ['id', 'name', 'done', 'timestamp'],
    };
    await myDatabase.addCollections({
        todos: {
            schema: todoSchema,
        },
    });
    await myDatabase.todos.bulkInsert([
        {
            id: 'todo1',
            name: 'Learn RxDB',
            done: false,
            timestamp: new Date().toISOString(),
        },
        {
            id: 'todo2',
            name: 'Learn RxDB 3',
            done: true,
            timestamp: new Date().toISOString(),
        },
        {
            id: 'todo3',
            name: 'Learn RxDB 2',
            done: true,
            timestamp: new Date().toISOString(),
        },
    ]);
    const foundDocuments = await myDatabase.todos
        .find({
            selector: {
                done: {
                    $eq: false,
                },
            },
        })
        .exec();
    expect(foundDocuments.length).toBe(1);
    expect(foundDocuments[0]?.id).toBe('todo1');

    const foundDocuments2 = await myDatabase.todos
        .find({
            selector: {
                done: {
                    $eq: true,
                },
            },
        })
        .exec();
    expect(foundDocuments2.length).toBe(2);
}, 60000); // Increase timeout for retries

test('complex queries and modifications', async () => {
    const myDatabase = await createTestDatabase<TodoCollections>(
        'test1',
        complexQueriesTestDbPath
    );
    const todoSchema = {
        version: 0,
        primaryKey: 'id',
        type: 'object',
        properties: {
            id: {
                type: 'string',
                maxLength: 100,
            },
            name: {
                type: 'string',
            },
            done: {
                type: 'boolean',
            },
            timestamp: {
                type: 'string',
                format: 'date-time',
            },
        },
        required: ['id', 'name', 'done', 'timestamp'],
    };
    await myDatabase.addCollections({
        todos: {
            schema: todoSchema,
        },
    });

    // Insert test data
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await myDatabase.todos.bulkInsert([
        {
            id: 'task1',
            name: 'Important task',
            done: false,
            timestamp: now.toISOString(),
        },
        {
            id: 'task2',
            name: 'Another important task',
            done: false,
            timestamp: yesterday.toISOString(),
        },
        {
            id: 'task3',
            name: 'Not so important',
            done: true,
            timestamp: now.toISOString(),
        },
    ]);

    // Test $or query
    const orResults = await myDatabase.todos
        .find({
            selector: {
                $or: [
                    { name: { $regex: '.*(i|I)mportant.*' } },
                    { done: true },
                ],
            },
        })
        .exec();
    expect(orResults.length).toBe(3);

    // Test update
    await myDatabase.todos
        .findOne({
            selector: { id: 'task1' },
        })
        .exec()
        .then((doc) => doc?.patch({ done: true }));

    const updatedDoc = await myDatabase.todos
        .findOne({
            selector: { id: 'task1' },
        })
        .exec();
    expect(updatedDoc?.done).toBe(true);

    // Test deletion
    await myDatabase.todos
        .findOne({
            selector: { id: 'task2' },
        })
        .exec()
        .then((doc) => doc?.remove());

    const afterDelete = await myDatabase.todos.find().exec();
    expect(afterDelete.length).toBe(2);
    await myDatabase.close();
}, 60000); // Increase timeout for retries

test('pagination and sorting', async () => {
    const myDatabase = await createTestDatabase<TodoCollections>(
        'test2',
        paginationTestDbPath
    );
    const todoSchema = {
        version: 0,
        primaryKey: 'id',
        type: 'object',
        properties: {
            id: {
                type: 'string',
                maxLength: 100,
            },
            name: {
                type: 'string',
            },
            done: {
                type: 'boolean',
            },
            timestamp: {
                type: 'string',
                format: 'date-time',
            },
        },
        required: ['id', 'name', 'done', 'timestamp'],
    };
    await myDatabase.addCollections({
        todos: {
            schema: todoSchema,
        },
    });

    // Insert test data
    const now = new Date();
    await myDatabase.todos.bulkInsert([
        {
            id: '1',
            name: 'A task',
            done: false,
            timestamp: now.toISOString(),
        },
        {
            id: '2',
            name: 'B task',
            done: false,
            timestamp: now.toISOString(),
        },
        {
            id: '3',
            name: 'C task',
            done: false,
            timestamp: now.toISOString(),
        },
        {
            id: '4',
            name: 'D task',
            done: true,
            timestamp: now.toISOString(),
        },
        {
            id: '5',
            name: 'E task',
            done: true,
            timestamp: now.toISOString(),
        },
    ]);

    // Test pagination
    const page1 = await myDatabase.todos.find().skip(0).limit(2).exec();
    expect(page1.length).toBe(2);

    const page2 = await myDatabase.todos.find().skip(2).limit(2).exec();
    expect(page2.length).toBe(2);

    // Test sorting
    const sortedByName = await myDatabase.todos
        .find()
        .sort({ name: 'desc' })
        .exec();
    expect(sortedByName[0]?.name).toBe('E task');
    await myDatabase.close();
}, 60000); // Increase timeout for retries
