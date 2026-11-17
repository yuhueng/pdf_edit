# YH-PDFEdit

**Live demo:** <https://pdf-edit-jet.vercel.app/>

An all-in-one PDF editor, merger and utility suite that runs entirely on your device. It provides a client-side workspace for merging, organizing, splitting, editing, and signing PDF files with zero server uploads.

> **Status:** v1.0. All local organizer, splitter, canvas editor, signature vault, Speed & Stress Lab, and offline PWA features are implemented. Existing PDF text can be replaced in place.

## Features (Phase 1)

- **Landing page:** shown on the bare address once per browser per 24 hours; "Get started" opens Split & Merge. Links to a tool (`#/split`, `#/compress`, ...) open the tool directly.
- **Open PDFs with the installed app:** on desktop Chrome/Edge the app is offered under "Open with" for PDFs (File Handling API); on Android Chrome it appears in the Share sheet (Web Share Target). Either way the PDF opens in Edit. iOS Safari supports neither.
- **Organize & Merge:** multi-file drag-and-drop, file-chip reordering, virtualized page-thumbnail grid (tested to 400 pages), per-page and batch rotate/delete, per-file page ranges, long-distance "Move to position…" control, form flattening on merge, and local download/share.
- **Split & Extract:** split by custom page groups (single PDF or `.zip`) or burst every page into a `.zip` archive.
- **Canvas Editor & e-Signatures:** single-page view with zoom (`50%`–`400%`, fit-width), text boxes (14 standard Latin-1 PDF fonts with styling), freehand pencil, multiply highlights, shapes (rectangle, ellipse, line, arrow), PNG/JPG images, date stamps, and Draw/Type/Upload signature dialog with an offline IndexedDB Signature Vault.
- **Speed & Stress Lab:** built-in synthetic PDF generator (`PERF-01`..`PERF-06`, `INV-01`..`INV-04`, `EDGE-01`..`EDGE-04`, plus custom stress workloads), live worker timing HUD, and JSON export.
- **Offline PWA:** installable manifest, bundled offline cursive fonts, and a small precache (about 3.7 MB). The large PDF engine is cached the first time Encrypt, Convert or text replacement is used, so those need a connection once.

## File size limits

Every tool accepts PDFs up to **1.9 GB each** (`MAX_FILE_BYTES` in `src/lib/format.ts`). Every tool shows **1.5 GB** on its drop zone (`SHOWN_MAX_BYTES`) as the size that works on ordinary machines, but still accepts files up to 1.9 GB. The 1.9 GB limit is a browser limit, not a setting:

- Chromium cannot allocate one memory buffer of 2 GiB or more (1.99 GiB works, 2.00 GiB fails), in the page or in a worker, and the PDF libraries (pdf-lib, pdf.js) need the whole file, or the whole result, in one buffer.
- MuPDF (mupdf.js 1.28) passes file positions as signed 32-bit numbers, so it cannot read past 2 GiB of a file.

So a 5 GB PDF cannot be opened by any tool in the browser with these libraries. Above the limit the app says so by name and size.

Other limits that follow from the same buffer cap:

- **Split & Merge:** a new file can be at most 1.9 GB, and may take pages from at most 3.8 GB of source PDFs (all its sources are loaded together while it is built).
- **ZIP downloads** (Split & Merge, Compress, Convert): a ZIP is built in one buffer, so when the files together are over 1.9 GB they download one by one instead.
- **Compress:** files over 256 MB are compressed one at a time instead of side by side. Each file shows a progress bar with its current step, time so far and an estimate of the time left; waiting files and the review dialog show an estimated time per file (from about 8 MB/s at first, then the speed measured on the device).

Memory needed is several times the file size (input, result, and the download copy). Machines with 8 GB of RAM, and phones, should stay well under the limit.

### Measured speed (stress tests)

Desktop Chromium, 4 CPU cores, 16 GB RAM, normal browser profile. Time from adding the file to the download (Compress: to its results); over 90 s counts as a fail. Test files: **scan** (one colour JPEG page per ~512 KB), **text** (one grey 300 dpi text page per ~1 MB), **noise** (8 huge uncompressible images).

| Tool | Scan | Text | Noise |
|---|---|---|---|
| Split & Merge | 1.9 GB in 22.4 s | 1.9 GB in 16.4 s | 1.9 GB in 9.0 s |
| Compress (to half size) | 500 MB in 67.8 s (−67%); 1 GB fails | 500 MB in 75.9 s (−93%); 1 GB fails | 1 GB in 84.0 s (−77%); 1.9 GB fails |
| Encrypt (AES-256) | 1.9 GB in 18.7 s | 1.9 GB in 19.1 s | 1.9 GB in 16.2 s |
| Decrypt | 1.9 GB in 35.3 s | not tested | not tested |
| Convert to HTML | fails at 100 MB (191 pages) | fails at 100 MB (93 pages) | 1.9 GB in 3.0 s (8 pages) |
| Convert to PNG | fails at 100 MB (191 pages) | 100 MB in 50.6 s; 250 MB fails | 1.9 GB in 2.8 s (8 pages) |
| Edit (open, add text, save) | 1.9 GB in 10.9 s | 1.9 GB in 8.8 s | 1.9 GB in 10.2 s |

Several files: Split & Merge 10 × 100 MB in 10.7 s and 5 × 250 MB in 11.9 s; Compress 5 × 250 MB in 89.0 s, 10 × 100 MB at about 90 s (passes or fails from run to run). Peak browser memory at 1.9 GB is 9–14 GB. Convert time follows the number of pages, not the file size.

Private (incognito) windows keep large Blobs in memory with a cap, so results of about 1.5 GB and more can fail to read there; normal windows move them to disk.

## Run

```bash
npm install
npm run dev
```

## Build & Deploy

```bash
npm run build         # Outputs static bundle + sw.js to dist/
npm run preview       # Preview the production build locally
```

Deploy to Vercel as a static Vite project (`Build Command: npm run build`, `Output Directory: dist`). [vercel.json](vercel.json) configures `must-revalidate` on `/index.html` and `/sw.js` and `immutable` caching on `/assets/*`.

## Speed & Stress Lab

Open the **Lab** tab in the app to run `PERF-01`..`PERF-06`, structural invariants (`INV-01`..`INV-04`), edge-case checks (`EDGE-01`..`EDGE-04`), or custom merge stress workloads directly in your browser's Web Worker, and copy the JSON report.


## Privacy

Your PDFs are processed entirely in your browser and are never uploaded. The app has no accounts, no analytics and no tracking code, and it makes no requests to any server other than the one that delivers the app itself.

One caveat: the host that serves the app (Vercel) keeps its own server access logs, such as IP address and requested URL, on its side. This is outside the app's control and cannot be turned off. It never includes your files.

## Source

Source code: <https://github.com/yuhueng/pdf_edit>

## License

Licensed under the [GNU AGPL-3.0](LICENSE), because the app bundles [MuPDF](https://mupdf.com) (AGPL-3.0). If you host a modified version, you must offer its source to your users. Third-party components and their licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
