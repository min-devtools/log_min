import { useEffect, useState } from "react";
import { listFonts } from "./logmin";

let cache: string[] | null = null;

/** system font families for the settings pickers (fetched once) */
export function useFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    listFonts()
      .then((f) => {
        cache = f;
        setFonts(f);
      })
      .catch(() => {});
  }, []);
  return fonts;
}
