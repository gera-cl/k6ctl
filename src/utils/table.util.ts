export function printColumnar(headers: string[], rows: string[][], title?: string): void {
    const colWidths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map(r => stripAnsi(r[i] ?? '').length))
    );
    if (title) console.log('\n' + title);
    console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join('  '));
    for (const row of rows) {
        const line = row.slice(0, headers.length).map((cell, i) => {
            const visible = stripAnsi(cell ?? '');
            const pad = colWidths[i] - visible.length;
            return (cell ?? '') + ' '.repeat(Math.max(0, pad));
        }).join('  ');
        console.log(line);
    }
}

/** Strip ANSI escape codes for accurate visible-length measurement. */
function stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Truncates a string to maxLen characters, keeping the start and end
 * and replacing the middle with '…'. Returns the original if short enough.
 */
export function truncateMiddle(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    const half = Math.floor((maxLen - 1) / 2);
    return str.slice(0, half) + '…' + str.slice(str.length - (maxLen - 1 - half));
}