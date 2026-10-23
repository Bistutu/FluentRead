/**
 * @file tests/helpers/filteredTreeWalker.ts
 * LinkeDOM's TreeWalker ignores acceptNode. Supply a lazy nextNode DOM port with
 * standard whatToShow, FILTER_SKIP and FILTER_REJECT behavior so privacy tests
 * execute the production predicate. No FluentRead selector or business rule lives here.
 */
export function installFilteredTreeWalker(document: Document): void {
    document.createTreeWalker = ((root: Node, whatToShow = 0xffffffff, filter?: NodeFilter | null) => {
        function* descendants(parent: Node): Generator<Node> {
            for (const child of Array.from(parent.childNodes)) {
                const visible = Boolean(whatToShow & (1 << (child.nodeType - 1)));
                const decision = !visible ? 3 : !filter ? 1
                    : typeof filter === 'function' ? filter(child) : filter.acceptNode(child);
                if (decision === 1) yield child;
                if (decision !== 2) yield* descendants(child);
            }
        }
        const iterator = descendants(root);
        return {nextNode: () => iterator.next().value ?? null} as TreeWalker;
    }) as Document['createTreeWalker'];
}
