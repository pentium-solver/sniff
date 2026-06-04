"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getAnnotation,
  getAllAnnotations,
  setAnnotation,
  subscribeAnnotations,
  type Annotation,
} from "@/lib/annotations";

/** Per-capture annotation hook. Re-renders whenever any annotation changes. */
export function useAnnotation(
  id: string
): [Annotation, (patch: Partial<Annotation>) => void] {
  const [ann, setAnn] = useState<Annotation>(() => getAnnotation(id));

  useEffect(() => {
    return subscribeAnnotations(() => setAnn(getAnnotation(id)));
  }, [id]);

  const update = useCallback(
    (patch: Partial<Annotation>) => setAnnotation(id, patch),
    [id]
  );

  return [ann, update];
}

/** Returns the full annotation map and re-renders on any mutation.
 *  Used by table components that need to split pinned/unpinned rows. */
export function useAnnotationsAll(): Record<string, Annotation> {
  const [all, setAll] = useState<Record<string, Annotation>>(
    () => getAllAnnotations()
  );

  useEffect(() => {
    return subscribeAnnotations(() => setAll(getAllAnnotations()));
  }, []);

  return all;
}
