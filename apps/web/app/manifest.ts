import type { MetadataRoute } from "next";
import { getServerUiCopy } from "../lib/server-ui-copy";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const copy = await getServerUiCopy();
  return {
    name: "LoveChapter",
    short_name: "LoveChapter",
    description: copy.metadata.description,
    start_url: "/",
    display: "standalone",
    background_color: "#fbf6ef",
    theme_color: "#71384b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
