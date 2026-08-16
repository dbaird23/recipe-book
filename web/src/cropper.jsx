import { useEffect, useRef, useState } from 'react';
import { Sheet } from './components.jsx';

const BOX = 260; // on-screen crop window
const OUT = 512; // exported image size

/**
 * Square photo cropper. The image is scaled to *cover* the crop window at
 * zoom 1, then the user drags to reposition and zooms in further. Panning is
 * clamped so the window can never show empty space.
 */
export default function AvatarCropper({ file, onCancel, onDone }) {
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Scale that makes the image just cover the crop window
  const base = img ? Math.max(BOX / img.width, BOX / img.height) : 1;
  const scale = base * zoom;
  const drawW = img ? img.width * scale : 0;
  const drawH = img ? img.height * scale : 0;

  const clamp = (p) => {
    const maxX = Math.max(0, (drawW - BOX) / 2);
    const maxY = Math.max(0, (drawH - BOX) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, p.x)),
      y: Math.min(maxY, Math.max(-maxY, p.y)),
    };
  };

  useEffect(() => { setPos((p) => clamp(p)); /* re-clamp when zoom changes */ // eslint-disable-next-line
  }, [zoom, img]);

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: pos };
  }
  function onPointerMove(e) {
    if (!drag.current) return;
    const d = drag.current;
    setPos(clamp({ x: d.start.x + (e.clientX - d.x), y: d.start.y + (e.clientY - d.y) }));
  }
  const onPointerUp = () => { drag.current = null; };

  async function apply() {
    if (!img || busy) return;
    setBusy(true);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // Map the on-screen transform onto the export canvas
    const k = OUT / BOX;
    ctx.drawImage(
      img,
      OUT / 2 - (drawW / 2 - pos.x) * k,
      OUT / 2 - (drawH / 2 - pos.y) * k,
      drawW * k,
      drawH * k
    );
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    setBusy(false);
    onDone(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
  }

  return (
    <Sheet onClose={onCancel}>
      <div className="sheet-title">Crop your photo</div>
      <div className="sheet-sub">Drag to reposition, and use the slider to zoom.</div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          width: BOX, height: BOX, margin: '16px auto 0', borderRadius: '50%', overflow: 'hidden',
          position: 'relative', background: '#e9e6df', cursor: 'grab', touchAction: 'none',
          boxShadow: '0 0 0 1px var(--card-bd)',
        }}
      >
        {img && (
          <img
            src={img.src}
            alt=""
            draggable={false}
            style={{
              position: 'absolute', left: '50%', top: '50%', width: drawW, height: drawH, maxWidth: 'none',
              transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`, userSelect: 'none',
            }}
          />
        )}
      </div>

      <input
        type="range"
        min="1"
        max="4"
        step="0.01"
        value={zoom}
        onChange={(e) => setZoom(+e.target.value)}
        style={{ width: '100%', marginTop: 18, accentColor: 'var(--green)' }}
        aria-label="Zoom"
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="btn-secondary" style={{ flex: 1, color: 'var(--chip-fg)', padding: 12 }} onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" style={{ flex: 2, width: 'auto', padding: 12 }} onClick={apply} disabled={!img || busy}>
          {busy ? 'Saving…' : 'Use photo'}
        </button>
      </div>
    </Sheet>
  );
}
