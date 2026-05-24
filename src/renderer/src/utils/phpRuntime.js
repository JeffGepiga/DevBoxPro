export function parsePhpRuntimeVersion(version) {
  const normalizedVersion = typeof version === 'string' ? version.trim() : String(version || '').trim();
  const match = normalizedVersion.match(/^(\d+(?:\.\d+)?)(?:-(nts|ts))?$/i);

  if (!match) {
    return {
      baseVersion: normalizedVersion,
      flavor: null,
    };
  }

  return {
    baseVersion: match[1],
    flavor: match[2]?.toLowerCase() || null,
  };
}

export function formatPhpRuntimeVersion(version) {
  const normalizedVersion = typeof version === 'string' ? version.trim() : String(version || '').trim();
  if (!normalizedVersion) {
    return '';
  }

  const { baseVersion, flavor } = parsePhpRuntimeVersion(normalizedVersion);

  if (flavor === 'ts') {
    return `${baseVersion} TS`;
  }

  if (flavor === 'nts') {
    return `${baseVersion} NTS`;
  }

  return baseVersion || normalizedVersion;
}

export function formatPhpRuntimeLabel(version) {
  const formattedVersion = formatPhpRuntimeVersion(version);
  return formattedVersion ? `PHP ${formattedVersion}` : 'PHP';
}