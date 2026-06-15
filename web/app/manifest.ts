import type { MetadataRoute } from "next";

// `share_target` is part of the Web Share Target spec but isn't in Next.js's
// `MetadataRoute.Manifest` type, so we build the object loosely and cast.
export default function manifest(): MetadataRoute.Manifest {
  const m = {
    name: "Grimoire",
    short_name: "Grimoire",
    description: "Your saved knowledge, searchable and ask-able.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2D3B23",
    icons: [
      {
        src: "/icons/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      // Maskable variants let Android crop to its adaptive-icon shape without
      // clipping artwork. The same square assets double as maskable here.
      {
        src: "/icons/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Lets Android's share sheet hand a shared link straight to /share-handler.
    share_target: {
      action: "/share-handler",
      method: "GET",
      params: {
        url: "url",
        text: "text",
        title: "title",
      },
    },
  };

  return m as unknown as MetadataRoute.Manifest;
}
