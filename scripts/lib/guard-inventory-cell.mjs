// Escape the escape character first, so an input backslash cannot consume
// the escape protecting a Markdown table delimiter.
export const escapeInventoryCell = value => String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
