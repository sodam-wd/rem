import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Seal image. The stamp SVGs carry an ink blur filter; some mobile browsers rasterise filtered SVGs inside
 * <img> at 1× and upscale them, so the seal looks smeared on high-density screens. The same SVG file is
 * therefore drawn once into a canvas sized for the device pixel ratio and shown instead. The SVG file
 * itself is untouched. Falls back to the plain <img> when canvas drawing is unavailable.
 */
export function Stamp({ src, alt, className, style }: { src: string; alt: string; className?: string; style?: CSSProperties }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDrawn(false);
    const source = new Image();
    source.decoding = 'async';
    source.onload = () => {
      if (cancelled) return;
      const el = imgRef.current;
      const canvas = canvasRef.current;
      if (!el || !canvas) return;
      const cssW = el.offsetWidth;
      const cssH = el.offsetHeight;
      if (!cssW || !cssH) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = Math.min(1600, Math.ceil(cssW * dpr * 1.5));
      const h = Math.round((w * cssH) / cssW);
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(source, 0, 0, w, h);
        setDrawn(true);
      } catch {
        /* keep the <img> */
      }
    };
    source.src = src;
    return () => {
      cancelled = true;
      source.onload = null;
    };
  }, [src]);

  return (
    <>
      <img ref={imgRef} className={className} style={{ ...style, display: drawn ? 'none' : undefined }} src={src} alt={alt} draggable={false} />
      <canvas ref={canvasRef} className={className} style={{ ...style, display: drawn ? undefined : 'none' }} role="img" aria-label={alt} aria-hidden={drawn ? undefined : true} />
    </>
  );
}
