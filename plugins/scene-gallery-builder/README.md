# Scene Gallery Builder

Scene Gallery Builder extracts still images from Stash scene videos and imports them as a ZIP-backed Stash Gallery linked to the source scene. It uses the local video file and Stash's configured FFmpeg; it does not download artwork from scraper sites.

## Use

Open **Scene Gallery Builder** from the plugin launcher. Choose an image-enabled library and set **Images per scene** to any value from **1 to 30** (8 by default). The value applies to the full library run and can be changed before generating an individual scene. **Smart** sampling looks for scene changes in a low-resolution pass, avoids detected black frames, skips near-identical samples where possible, and fills gaps with evenly spaced frames. Choose **Evenly spaced** for a faster run without scene-change analysis. Both modes avoid the first and last 6% of the video.

Use **Generate or update galleries** to process scenes with video files, or use **Generate**/**Refresh** beside a scene to process it individually. The table shows each scene's gallery and task status. A gallery is skipped only when its requested images are indexed, attached to the gallery, and linked to the scene. Incomplete or unlinked galleries are refreshed. Stash job progress is shown in the page, and active jobs can be cancelled.

## Files and Stash links

For each scene, the plugin writes to an isolated folder under the selected image library: `Scene Gallery Builder/sgb-scene-<scene-id>/`. Image names follow the scene title with a three-digit ordinal, for example `Behind the Scenes_001.jpg`, `Behind the Scenes_002.jpg`. The ZIP uses the scene title as its filename, for example `Behind the Scenes.zip`. Characters that filesystems do not allow are replaced with underscores.

Stash scans the ZIP and creates a Gallery from its images. The plugin copies supported scene metadata to the Gallery and its images, then links the Gallery to the source scene and verifies the relationship in both directions. It also verifies that every ZIP image is attached to that Gallery. The generated Gallery is titled `<scene title> — Scene Gallery` and receives a stable `SGB-<scene-id>` code where supported. A small manifest keeps reruns associated with the same generated files and Gallery. The source video is never modified.

Stash must scan ZIP archives in the selected image library. Generated stills are kept inside the ZIP; temporary loose copies are removed before Stash scans the folder. If the Gallery is not created, confirm the image library includes the output folder and that ZIP/CBZ scanning is enabled.

## Automatic generation

Automatic generation for newly created scenes is optional and off by default. Enable **Automatically generate galleries for new scenes** in **Stash → Settings → Plugins → Scene Gallery Builder**. **Default images per scene** controls the automatic run count. **Image library path** can select the library used for automatic runs; if empty, the first image-enabled library is used.

## Requirements

- Stash's server process needs Python 3.8 or newer and access to its configured FFmpeg binary. FFprobe is used if Stash does not have the scene duration.
- The generated output path must be inside an existing Stash library that allows images. The plugin validates this before writing files.
- Scenes without a video file or a usable duration are skipped in a library run.
- Gallery and image metadata is copied only for fields supported by the installed Stash GraphQL schema.

Install from the repository source in the root README or download the [1.0.0 manual archive](../../packages/scene-gallery-builder/1.0.0-manual.zip) and extract the `scene-gallery-builder/` directory into Stash's configured plugins directory. Enable the plugin in **Settings → Plugins**. If updating manually, reload Stash's plugins and reopen the plugin page so its versioned assets load.

The page follows the active Stash theme for its surfaces, typography, borders, and accent color.
