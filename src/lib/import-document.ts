/**
 * Turns a document file into Markdown in the browser, so it can be imported
 * into a doc or task description. Converters load on demand; none of them
 * ship with the page.
 */

/** File types the import button offers. */
export const IMPORT_ACCEPT = [
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.text',
  '.html',
  '.htm',
  '.docx',
  '.pdf',
  '.csv',
  '.tsv',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.sql',
  '.log'
].join(',');

const MAX_BYTES = 10 * 1024 * 1024;

/** Files shown as a code block, with the fence language to use. */
const CODE_LANGUAGES: Record<string, string> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  log: 'txt'
};

export class ImportError extends Error {}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

async function htmlToMarkdown(html: string): Promise<string> {
  const [{ default: TurndownService }, { gfm }] = await Promise.all([
    import('turndown'),
    import('@joplin/turndown-plugin-gfm')
  ]);
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  });
  turndown.use(gfm);
  // Scripts, styles and embedded (data URI) images would only bloat the text.
  turndown.remove(['script', 'style', 'noscript']);
  turndown.addRule('dropInlineImages', {
    filter: (node) =>
      node.nodeName === 'IMG' && (node.getAttribute('src') ?? '').startsWith('data:'),
    replacement: () => ''
  });
  return turndown.turndown(html);
}

/** Splits one CSV or TSV line, honouring double-quoted cells. */
function splitRow(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function tableToMarkdown(text: string, separator: string): string {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => splitRow(line, separator).map((cell) => cell.trim().replaceAll('|', '\\|')));
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array.from({ length: width - row.length }, () => '')];
  const line = (row: string[]) => `| ${pad(row).join(' | ')} |`;
  return [
    line(rows[0]),
    line(Array.from({ length: width }, () => '---')),
    ...rows.slice(1).map(line)
  ].join('\n');
}

async function pdfToMarkdown(file: File): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: false });
  // PDFs carry no structure, so pages become paragraphs split by a rule.
  return text
    .map((page) => page.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean)
    .join('\n\n---\n\n');
}

/**
 * Reads a file and returns its content as Markdown.
 * Throws ImportError with a readable message when the file can't be used.
 */
export async function fileToMarkdown(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new ImportError('Files over 10 MB can’t be imported.');
  const ext = extension(file.name);

  let markdown: string;
  switch (ext) {
    case 'md':
    case 'markdown':
    case 'mdx':
    case 'txt':
    case 'text':
      markdown = await file.text();
      break;
    case 'html':
    case 'htm':
      markdown = await htmlToMarkdown(await file.text());
      break;
    case 'docx': {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      markdown = await htmlToMarkdown(value);
      break;
    }
    case 'pdf':
      markdown = await pdfToMarkdown(file);
      break;
    case 'csv':
      markdown = tableToMarkdown(await file.text(), ',');
      break;
    case 'tsv':
      markdown = tableToMarkdown(await file.text(), '\t');
      break;
    default: {
      const language = CODE_LANGUAGES[ext];
      if (!language) {
        throw new ImportError(
          'That file type isn’t supported. Use Markdown, text, Word (.docx), PDF, HTML or CSV.'
        );
      }
      markdown = `\`\`\`${language}\n${(await file.text()).trimEnd()}\n\`\`\``;
    }
  }

  markdown = markdown.replace(/^﻿/, '').trim();
  if (!markdown) throw new ImportError('That file has no text to import.');
  return markdown;
}
