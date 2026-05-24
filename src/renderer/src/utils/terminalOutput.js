const OSC_PATTERN = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:[0-?]*[ -/]*[@-~])/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u000C\u000E-\u001A\u001C-\u001F\u007F]/g;

function normalizeLine(line) {
  const normalized = line.replace(/[\t ]+$/g, '');
  return normalized.trim() ? normalized : null;
}

export function normalizeInstallationOutput(text) {
  const source = String(text ?? '')
    .replace(OSC_PATTERN, '')
    .replace(ANSI_PATTERN, '')
    .replace(CONTROL_PATTERN, '')
    .replace(/\r\n/g, '\n');

  if (!source.trim()) {
    return [];
  }

  return source
    .split('\n')
    .map((line) => {
      const segments = line
        .split('\r')
        .map(normalizeLine)
        .filter(Boolean);

      return segments.length ? segments[segments.length - 1] : null;
    })
    .filter(Boolean);
}
