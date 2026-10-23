export interface UiMessageReference {
    file: string;
    location: string;
    keys: string[];
    params: string[] | undefined;
}
export function collectUiMessageReferences(root: string): {
    references: UiMessageReference[];
    dynamic: Array<{file: string; location: string; expression: string}>;
};
export function auditUiMessageReferences(references: UiMessageReference[], catalog: Readonly<Record<string, string>>): string[];
