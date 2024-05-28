// utils/storage.ts
const showChangelogOnUpdate = storage.defineItem<boolean>(
    'local:showChangelogOnUpdate',
    {
        defaultValue: true,
    },
);
