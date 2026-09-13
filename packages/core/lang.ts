// Language by file extension, colored like GitHub's linguist. Data files become low warehouses, not towers.
export interface Lang { name: string; color: number; data: boolean }

const OTHER: Lang = { name: 'Other', color: 0x9aa0a8, data: false }
const DATA: Lang = { name: 'Data', color: 0x8a8f98, data: true }
const lang = (name: string, color: number, ...exts: string[]) =>
  exts.map(e => [e, { name, color, data: false }] as const)

const BY_EXT = new Map<string, Lang>([
  ...lang('TypeScript', 0x3178c6, 'ts', 'tsx', 'mts', 'cts'),
  ...lang('JavaScript', 0xf1e05a, 'js', 'jsx', 'mjs', 'cjs'),
  ...lang('Python', 0x3572a5, 'py'),
  ...lang('Rust', 0xdea584, 'rs'),
  ...lang('Go', 0x00add8, 'go'),
  ...lang('Java', 0xb07219, 'java'),
  ...lang('Kotlin', 0xa97bff, 'kt', 'kts'),
  ...lang('Swift', 0xf05138, 'swift'),
  ...lang('C', 0x555555, 'c', 'h'),
  ...lang('C++', 0xf34b7d, 'cpp', 'cc', 'cxx', 'hpp', 'hh'),
  ...lang('C#', 0x178600, 'cs'),
  ...lang('Ruby', 0x701516, 'rb'),
  ...lang('PHP', 0x4f5d95, 'php'),
  ...lang('Lua', 0x000080, 'lua'),
  ...lang('Dart', 0x00b4ab, 'dart'),
  ...lang('HTML', 0xe34c26, 'html', 'htm'),
  ...lang('CSS', 0x663399, 'css'),
  ...lang('SCSS', 0xc6538c, 'scss', 'sass'),
  ...lang('Vue', 0x41b883, 'vue'),
  ...lang('Svelte', 0xff3e00, 'svelte'),
  ...lang('Shell', 0x89e051, 'sh', 'bash', 'zsh'),
  ...lang('PowerShell', 0x012456, 'ps1', 'psm1'),
  ...lang('SQL', 0xe38c00, 'sql'),
  ...lang('Markdown', 0x083fa1, 'md', 'mdx'),
  ...lang('YAML', 0xcb171e, 'yml', 'yaml'),
  ...lang('TOML', 0x9c4221, 'toml'),
  ...['json', 'jsonl', 'ndjson', 'csv', 'tsv', 'xml', 'svg', 'snap'].map(e => [e, DATA] as const),
])

export function langOf(path: string): Lang {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  return (dot > 0 && BY_EXT.get(name.slice(dot + 1))) || OTHER
}
