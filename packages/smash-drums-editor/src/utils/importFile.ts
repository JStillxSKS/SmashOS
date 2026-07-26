import type { FileWithPath } from "./siblingFile";

export type PickedImportFile = {
  path: string;
  name: string;
  bytes: number[];
};

export function fileFromImportPick(pick: PickedImportFile): FileWithPath {
  const file = new File([new Uint8Array(pick.bytes)], pick.name) as FileWithPath;
  file.path = pick.path;
  return file;
}

export async function pickImportFileDesktop(): Promise<FileWithPath | null> {
  const pick = await window.electronAPI?.pickImportFile?.();
  if (!pick) return null;
  return fileFromImportPick(pick);
}