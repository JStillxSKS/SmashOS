export type FileWithPath = File & { path?: string };

function resolveFilePath(file: FileWithPath): string | null {
  const fromApi = window.electronAPI?.getFilePath?.(file);
  if (fromApi) return fromApi;
  return file.path ?? null;
}

export function fileDirectory(file: FileWithPath): string | null {
  const filePath = resolveFilePath(file);
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return null;
  return normalized.slice(0, slash);
}

export async function loadSiblingFile(
  sourceFile: FileWithPath,
  siblingName: string
): Promise<File | null> {
  const api = window.electronAPI;
  const filePath = resolveFilePath(sourceFile);
  if (!api?.readSiblingFile || !filePath) return null;

  const result = await api.readSiblingFile(filePath, siblingName);
  if (!result) return null;

  const blob = new Blob([new Uint8Array(result.bytes)]);
  return new File([blob], result.name, { type: result.mimeType || undefined });
}