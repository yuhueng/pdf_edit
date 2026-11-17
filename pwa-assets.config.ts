import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// The icon (public/icon.svg) is a full-bleed paper square whose page already sits inside the maskable safe
// zone, so no preset adds padding, and any filled background is the paper colour (#f6f5f1).
const paper = { background: '#f6f5f1' };

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: paper },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: paper },
  },
  images: ['public/icon.svg'],
});
