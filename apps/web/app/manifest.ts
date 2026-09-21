import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LoveChapter",
    short_name: "LoveChapter",
    description: "A calm wedding planning and RSVP workspace.",
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
