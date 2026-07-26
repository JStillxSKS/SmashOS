import type { User } from "@supabase/supabase-js";
import type { ChartNote, Difficulty, MetaJson } from "../types/meta";
import { imageFileToCoverPng } from "../utils/indiesIO";
import { bpmFromAnchors } from "../utils/timing";
import { supabase } from "./supabase";

export const INDIES_DB_ORIGIN = "https://indies-db.vercel.app";

type DifficultyCounts = {
  easy: number;
  normal: number;
  hard: number;
  extreme: number;
};

function difficultyCounts(charts: Record<Difficulty, ChartNote[]>): DifficultyCounts {
  return {
    easy: charts.easy.length,
    normal: charts.normal.length,
    hard: charts.hard.length,
    extreme: charts.extreme.length,
  };
}

export type PublishResult = {
  mapId: string;
  mapUrl: string;
  isUpdate: boolean;
};

export async function publishIndiesPackage(options: {
  user: User;
  indiesBlob: Blob;
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
  coverFile: File | null;
  existingMapId?: string | null;
  explicit?: boolean;
}): Promise<PublishResult> {
  const { user, indiesBlob, meta, charts, coverFile, existingMapId, explicit = false } = options;
  if (!supabase) {
    throw new Error(
      "Indies-DB is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env."
    );
  }

  const file = new File([indiesBlob], "package.indies", { type: "application/zip" });
  let mapId = existingMapId?.trim() || crypto.randomUUID();
  let filePath = `maps/${user.id}/${mapId}.indies`;
  let coverPath: string | null = null;
  let isUpdate = false;

  if (existingMapId?.trim()) {
    const { data: existing, error: fetchErr } = await supabase
      .from("maps")
      .select("id, mapper_id, file_path, cover_path")
      .eq("id", existingMapId.trim())
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (existing && existing.mapper_id === user.id) {
      isUpdate = true;
      mapId = existing.id;
      filePath = existing.file_path;
      coverPath = existing.cover_path;

      const { error: removeErr } = await supabase.storage.from("indies").remove([filePath]);
      if (removeErr) throw removeErr;
    } else {
      mapId = crypto.randomUUID();
      filePath = `maps/${user.id}/${mapId}.indies`;
    }
  }

  const { error: uploadErr } = await supabase.storage
    .from("indies")
    .upload(filePath, file, { upsert: false, contentType: "application/zip" });
  if (uploadErr) throw uploadErr;

  if (coverFile) {
    const newCoverPath = `covers/${user.id}/${mapId}.png`;
    const coverBlob = await imageFileToCoverPng(coverFile);
    if (isUpdate && coverPath) {
      await supabase.storage.from("indies").remove([coverPath]);
    }
    const { error: coverErr } = await supabase.storage
      .from("indies")
      .upload(newCoverPath, coverBlob, { upsert: false, contentType: "image/png" });
    if (!coverErr) coverPath = newCoverPath;
  }

  const row = {
    title: meta.NameSong?.trim() || "Untitled Song",
    artist: meta.NameArtist?.trim() || "Unknown Artist",
    charter: meta.NameCharter?.trim() || "Unknown Charter",
    file_path: filePath,
    cover_path: coverPath,
    bpm_est: bpmFromAnchors(meta.SongTiming),
    difficulties: difficultyCounts(charts),
    explicit,
  };

  if (isUpdate) {
    const { error: updateErr } = await supabase.from("maps").update(row).eq("id", mapId);
    if (updateErr) throw updateErr;
  } else {
    const { error: insertErr } = await supabase.from("maps").insert({
      id: mapId,
      mapper_id: user.id,
      ...row,
    });
    if (insertErr) throw insertErr;
  }

  return {
    mapId,
    mapUrl: `${INDIES_DB_ORIGIN}/maps/${mapId}`,
    isUpdate,
  };
}