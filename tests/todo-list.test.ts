import test from 'ava';
import fs from 'fs';
import { addRxPlugin, createRxDatabase, type RxCollection } from 'rxdb';
import { getRxStoragePGLite } from '../src';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';

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

const todoListTestDbPath = __dirname + '/todo-list-test.db';
const complexQueriesTestDbPath = __dirname + '/complex-queries-test.db';
const paginationTestDbPath = __dirname + '/pagination-test.db';

test.beforeEach(() => {
    [
        todoListTestDbPath,
        complexQueriesTestDbPath,
        paginationTestDbPath,
    ].forEach((path) => {
        fs.rm(path, { recursive: true }, () => {});
    });
});

test.afterEach(() => {
    [
        todoListTestDbPath,
        complexQueriesTestDbPath,
        paginationTestDbPath,
    ].forEach((path) => {
        fs.rm(path, { recursive: true }, () => {});
    });
});

test('todo list test', async (t) => {
    const myDatabase = await createRxDatabase<TodoCollections>({
        name: 'test0',
        storage: getRxStoragePGLite({ path: todoListTestDbPath }),
    });
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
    t.is(foundDocuments.length, 1);
    t.is(foundDocuments[0]?.id, 'todo1');

    const foundDocuments2 = await myDatabase.todos
        .find({
            selector: {
                done: {
                    $eq: true,
                },
            },
        })
        .exec();
    t.is(foundDocuments2.length, 2);
});

test('complex queries and modifications', async (t) => {
    const myDatabase = await createRxDatabase<TodoCollections>({
        name: 'test1',
        storage: getRxStoragePGLite({ path: complexQueriesTestDbPath }),
    });
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
    t.is(orResults.length, 3);

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
    t.is(updatedDoc?.done, true);

    // Test deletion
    await myDatabase.todos
        .findOne({
            selector: { id: 'task2' },
        })
        .exec()
        .then((doc) => doc?.remove());

    const afterDelete = await myDatabase.todos.find().exec();
    t.is(afterDelete.length, 2);
});

test('pagination and sorting', async (t) => {
    const myDatabase = await createRxDatabase<TodoCollections>({
        name: 'test2',
        storage: getRxStoragePGLite({ path: paginationTestDbPath }),
    });
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
    t.is(page1.length, 2);

    const page2 = await myDatabase.todos.find().skip(2).limit(2).exec();
    t.is(page2.length, 2);

    // Test sorting
    const sortedByName = await myDatabase.todos
        .find()
        .sort({ name: 'desc' })
        .exec();
    t.is(sortedByName[0]?.name, 'E task');
});
