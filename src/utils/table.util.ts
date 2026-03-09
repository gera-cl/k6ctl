import Table from "cli-table3";

type TablePrinterOptions<T> = {
    title?: string;
    headers: string[];
    items: T[];
    toRows: (item: T) => Array<(string | number)[]>;
    footer?: string;
};

export function printTableGeneric<T>(opts: TablePrinterOptions<T>): void {
    const table = new Table({
        head: opts.headers,
        wordWrap: true,
    });
    for (const item of opts.items) {
        const rows = opts.toRows(item);
        for (const row of rows) table.push(row);
    }
    if (opts.title) console.log(opts.title);
    console.log(table.toString());
    if (opts.footer) console.log(opts.footer);
}